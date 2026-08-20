'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { assertProviderResult } = require('../src/providers/provider-contract');
const execution = require('../worker/v2.1-execution-engine');
const { StageRunner } = require('../worker/v2.1-stage-runner');

const root = path.resolve(__dirname, '..');
const migrations = ['migrations/002_v2_1_execution.sql'];

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function run() {
  const db = client();
  const storageRoot = path.join(os.tmpdir(), `cf-v2.1-stage-${process.pid}`);
  const fakeNvidia = {
    provider: 'nvidia', model: 'nvidia/test-model',
    supports({ capability }) { return capability === 'text-generation'; },
    async generate({ prompt, model }) {
      return assertProviderResult({ provider: 'nvidia', model: model || this.model,
        output: `generated:${prompt}`, requestId: 'postgres-stage-runner-test', usage: { total_tokens: 4 } });
    },
  };

  await db.connect();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');

    // The V2.1 execution migration intentionally depends on the canonical
    // V2 workspace/job identities. Create only the minimal fixture needed
    // for this isolated execution-layer certification.
    await db.query(`
      CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_jobs (id uuid PRIMARY KEY);
    `);

    for (const migration of migrations) {
      await db.query(fs.readFileSync(path.join(root, migration), 'utf8'));
    }

    await db.query(`
      INSERT INTO workspaces(id, name)
      VALUES ('00000000-0000-0000-0000-000000000021', 'stage-runner-cert')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO v2_1.productions(workspace_id, idempotency_key, status, immutable_context)
      VALUES ('00000000-0000-0000-0000-000000000021', 'stage-runner-production', 'DRAFT', '{"test":true}')
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;
      INSERT INTO v2_1.jobs(production_id, workspace_id, idempotency_key, status, max_attempts)
      SELECT p.id, p.workspace_id, 'stage-runner-job', 'QUEUED', 3
      FROM v2_1.productions p
      WHERE p.idempotency_key='stage-runner-production'
      ON CONFLICT (production_id, idempotency_key) DO NOTHING;
    `);

    const job = (await db.query(`SELECT j.id FROM v2_1.jobs j JOIN v2_1.productions p ON p.id=j.production_id
      WHERE p.idempotency_key='stage-runner-production' AND j.idempotency_key='stage-runner-job'`)).rows[0];
    assert.ok(job);
    const claimedJob = await execution.claimJob(db, { workerId: 'stage-runner-worker', leaseSeconds: 60 });
    assert.equal(claimedJob.id, job.id);
    const stageRun = await execution.claimNextStage(db, { jobId: job.id, workerId: 'stage-runner-worker', leaseSeconds: 60 });
    assert.equal(stageRun.stage, 'SIGNAL');

    const gateway = new ProviderGateway({ providers: { nvidia: fakeNvidia }, priorities: { nvidia: 10 } });
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifacts = new ArtifactService({ storage });
    const runner = new StageRunner({ execution, providerGateway: gateway, artifactService: artifacts,
      handlers: { SIGNAL: async ({ providerGateway }) => {
        const result = await providerGateway.generate({ capability: 'text-generation', prompt: 'signal from postgres job' });
        return { artifacts: [{ artifactId: 'postgres-stage-runner-artifact', type: 'text', content: result.output,
          provider: result.provider, model: result.model }], provenance: result.provenance };
      } } });

    const result = await runner.run({ client: db, workerId: 'stage-runner-worker', stageRun });
    assert.equal(result.status, 'COMPLETED');
    const persisted = (await db.query('SELECT status, worker_id, output_artifacts, output_fingerprint FROM v2_1.stage_runs WHERE id=$1', [stageRun.id])).rows[0];
    assert.equal(persisted.status, 'COMPLETED');
    assert.equal(persisted.worker_id, null);
    assert.equal(persisted.output_artifacts[0], result.outputArtifacts[0]);
    assert.match(persisted.output_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal((await storage.get({ key: result.outputArtifacts[0] })).toString('utf8'), 'generated:signal from postgres job');
    console.log('V2.1 PostgreSQL → execution → stage runner → provider → artifact → storage: PASS');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS generation_jobs').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces').catch(() => {});
    await db.end();
    await fs.promises.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
