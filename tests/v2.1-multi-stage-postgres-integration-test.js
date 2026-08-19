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
const { STAGE_ORDER } = require('../worker/v2.1-production-contract');

const root = path.resolve(__dirname, '..');
const migrations = [
  'migrations/002_v2_1_execution.sql',
  'migrations/20260819_v2_1_stage_input_propagation.sql',
];

function makeClient() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function run() {
  const db = makeClient();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v2.1-multi-pg-'));
  const workerId = 'multi-stage-postgres-worker';
  const productionKey = `multi-stage-postgres-${process.pid}`;
  const jobKey = `multi-stage-job-${process.pid}`;

  const fakeNvidia = {
    provider: 'nvidia',
    model: 'nvidia/test-model',
    supports({ capability }) { return capability === 'text-generation'; },
    async generate({ prompt, model }) {
      return assertProviderResult({
        provider: 'nvidia',
        model: model || this.model,
        output: `generated:${prompt}`,
        requestId: `postgres-multi-${Date.now()}`,
        usage: { total_tokens: 4 },
      });
    },
  };

  await db.connect();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
    for (const migration of migrations) {
      await db.query(fs.readFileSync(path.join(root, migration), 'utf8'));
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, name text NOT NULL);
      INSERT INTO workspaces(id, name)
      VALUES ('00000000-0000-0000-0000-000000000021', 'multi-stage-postgres-cert')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO v2_1.productions(workspace_id, idempotency_key, status, immutable_context)
      VALUES ('00000000-0000-0000-0000-000000000021', $1, 'DRAFT', '{"test":true}')
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

      INSERT INTO v2_1.jobs(production_id, workspace_id, idempotency_key, status, max_attempts)
      SELECT p.id, p.workspace_id, $2, 'QUEUED', 3
      FROM v2_1.productions p
      WHERE p.idempotency_key=$1
      ON CONFLICT (production_id, idempotency_key) DO NOTHING;
    `, [productionKey, jobKey]);

    const job = (await db.query(`
      SELECT j.id, j.production_id
      FROM v2_1.jobs j
      JOIN v2_1.productions p ON p.id=j.production_id
      WHERE p.idempotency_key=$1 AND j.idempotency_key=$2
    `, [productionKey, jobKey])).rows[0];
    assert.ok(job);

    const claimedJob = await execution.claimJobForProduction(db, {
      jobId: job.id,
      productionId: job.production_id,
      workerId,
      leaseSeconds: 60,
    });
    assert.equal(claimedJob.id, job.id);

    const gateway = new ProviderGateway({ providers: { nvidia: fakeNvidia }, priorities: { nvidia: 10 } });
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifacts = new ArtifactService({ storage });

    const handlers = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, async ({ providerGateway, inputArtifacts }) => {
      const input = inputArtifacts.length ? inputArtifacts.join(',') : 'ROOT';
      const result = await providerGateway.generate({
        capability: 'text-generation',
        prompt: `${stage}|input=${input}`,
      });
      return {
        artifacts: [{
          artifactId: `pg-multi-${stage.toLowerCase()}`,
          type: 'text',
          content: result.output,
          provider: result.provider,
          model: result.model,
        }],
        provenance: result.provenance,
      };
    }]));

    const runner = new StageRunner({
      execution,
      providerGateway: gateway,
      artifactService: artifacts,
      handlers,
    });

    let previousOutputs = [];

    for (let index = 0; index < STAGE_ORDER.length; index += 1) {
      const stageRun = await execution.claimNextStage(db, {
        jobId: job.id,
        workerId,
        leaseSeconds: 60,
      });
      assert.ok(stageRun, `expected stage ${STAGE_ORDER[index]}`);
      assert.equal(stageRun.stage, STAGE_ORDER[index]);
      assert.deepEqual(stageRun.input_artifacts, previousOutputs);

      const result = await runner.run({ client: db, stageRun, workerId });
      assert.equal(result.status, 'COMPLETED');
      assert.equal(result.outputArtifacts.length, 1);
      assert.match(result.outputFingerprint, /^[a-f0-9]{64}$/);

      const persisted = (await db.query(`
        SELECT status, input_artifacts, output_artifacts, input_fingerprint, output_fingerprint, worker_id
        FROM v2_1.stage_runs WHERE id=$1
      `, [stageRun.id])).rows[0];
      assert.equal(persisted.status, 'COMPLETED');
      assert.deepEqual(persisted.input_artifacts, previousOutputs);
      assert.deepEqual(persisted.output_artifacts, result.outputArtifacts);
      assert.equal(persisted.worker_id, null);

      const stored = await storage.get({ key: result.outputArtifacts[0] });
      assert.match(stored.toString('utf8'), new RegExp(`^generated:${stage}\\|input=`));
      previousOutputs = result.outputArtifacts;
    }

    assert.equal((await execution.claimNextStage(db, { jobId: job.id, workerId })).stage, undefined);
    assert.equal((await db.query(
      `SELECT count(*)::int AS count FROM v2_1.stage_runs WHERE job_id=$1 AND status='COMPLETED'`,
      [job.id]
    )).rows[0].count, STAGE_ORDER.length);

    await execution.completeJob(db, { jobId: job.id, workerId });

    const final = (await db.query(`
      SELECT j.status AS job_status, p.status AS production_status
      FROM v2_1.jobs j JOIN v2_1.productions p ON p.id=j.production_id
      WHERE j.id=$1
    `, [job.id])).rows[0];
    assert.equal(final.job_status, 'COMPLETED');
    assert.equal(final.production_status, 'COMPLETED');

    console.log(`V2.1 PostgreSQL full multi-stage lifecycle (${STAGE_ORDER.length} stages): PASS`);
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces').catch(() => {});
    await db.end();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
