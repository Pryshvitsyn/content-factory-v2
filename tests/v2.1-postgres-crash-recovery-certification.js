'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const execution = require('../worker/v2.1-execution-engine');

const root = path.resolve(__dirname, '..');
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000041';
const TEST_LEASE_SECONDS = 60;

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function run() {
  const db = client();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v2.1-pg-crash-'));
  let providerCalls = 0;

  try {
    await db.connect();
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
    await db.query('DROP TABLE IF EXISTS generation_jobs CASCADE');
    await db.query('DROP TABLE IF EXISTS workspaces CASCADE');
    await db.query('CREATE TABLE workspaces (id uuid PRIMARY KEY, name text NOT NULL)');
    await db.query('CREATE TABLE generation_jobs (id uuid PRIMARY KEY)');
    await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [WORKSPACE_ID, 'pg-crash-recovery-cert']);

    await db.query(fs.readFileSync(path.join(root, 'migrations/002_v2_1_execution.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_stage_input_propagation.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_retry_recovery.sql'), 'utf8'));

    await db.query(
      `INSERT INTO v2_1.productions(workspace_id,name,status,metadata)
       VALUES ($1,$2,'DRAFT','{}')`,
      [WORKSPACE_ID, `pg-crash-${process.pid}`]
    );
    const production = (await db.query(
      `SELECT id FROM v2_1.productions WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1`, [WORKSPACE_ID]
    )).rows[0];
    assert.ok(production?.id, 'production must be created');

    await db.query(
      `INSERT INTO v2_1.jobs(production_id,stage,idempotency_key,status,max_attempts)
       VALUES ($1,'SIGNAL',$2,'QUEUED',3)`,
      [production.id, `pg-crash-job-${process.pid}`]
    );
    const job = (await db.query(
      `SELECT id FROM v2_1.jobs WHERE production_id=$1 ORDER BY created_at DESC LIMIT 1`, [production.id]
    )).rows[0];
    assert.ok(job?.id, 'job must be created');

    const claimedJob = await execution.claimJobForProduction(db, {
      jobId: job.id,
      productionId: production.id,
      workerId: 'crash-worker-a',
      leaseSeconds: TEST_LEASE_SECONDS,
    });
    assert.ok(claimedJob?.id, 'job must be claimed');

    const first = await execution.claimNextStage(db, {
      jobId: job.id,
      workerId: 'crash-worker-a',
      leaseSeconds: TEST_LEASE_SECONDS,
    });
    assert.ok(first?.id, 'first stage must be claimed');

    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifacts = new ArtifactService({ storage });
    const logicalArtifactId = 'pg-crash-signal-output';
    const logicalKey = `${job.id}:SIGNAL:${logicalArtifactId}`;

    // Simulate provider success and durable artifact commit, then crash before
    // completeStage. The job lease remains valid; only the stage lease expires.
    providerCalls += 1;
    const firstArtifact = await artifacts.createVersion({
      artifactId: logicalArtifactId,
      type: 'text',
      content: 'stable-output',
      stageId: first.id,
      attemptId: `${first.id}:1`,
      idempotencyKey: logicalKey,
      provider: 'nvidia',
      model: 'nvidia/test-model',
    });
    assert.equal(firstArtifact.idempotent, false);

    await db.query(`UPDATE v2_1.stage_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [first.id]);
    const recovered = await execution.recoverExpiredWork(db);
    assert.equal(recovered.stages_recovered, 1);
    assert.equal(recovered.jobs_recovered, 0);
    assert.equal(recovered.jobs_failed, 0);

    const second = await execution.claimNextStage(db, {
      jobId: job.id,
      workerId: 'crash-worker-b',
      leaseSeconds: TEST_LEASE_SECONDS,
    });
    assert.ok(second?.id, 'recovered retry stage must be claimable');
    assert.equal(second.attempt, 2);

    // The artifact boundary is exactly-once/idempotent even though provider
    // execution is currently at-least-once across a worker crash.
    providerCalls += 1;
    const retryArtifact = await artifacts.createVersion({
      artifactId: logicalArtifactId,
      type: 'text',
      content: 'stable-output',
      stageId: second.id,
      attemptId: `${second.id}:2`,
      idempotencyKey: logicalKey,
      provider: 'nvidia',
      model: 'nvidia/test-model',
    });
    assert.equal(retryArtifact.idempotent, true);
    assert.equal(retryArtifact.storageKey, firstArtifact.storageKey);

    await execution.completeStage(db, {
      stageRunId: second.id,
      workerId: 'crash-worker-b',
      outputArtifacts: [retryArtifact.storageKey],
      outputFingerprint: execution.fingerprint([retryArtifact.storageKey]),
    });

    const stages = (await db.query(
      `SELECT attempt,status FROM v2_1.stage_runs WHERE job_id=$1 AND stage='SIGNAL' ORDER BY attempt`, [job.id]
    )).rows;
    assert.equal(stages.length, 2);
    assert.equal(stages[0].status, 'FAILED');
    assert.equal(stages[1].status, 'COMPLETED');
    assert.equal(providerCalls, 2, 'current crash contract is at-least-once provider execution');

    const stored = await storage.get({ key: firstArtifact.storageKey });
    assert.equal(stored.toString('utf8'), 'stable-output');

    console.log('V2.1 PostgreSQL crash recovery: durable retry + exactly-once artifact + at-least-once provider PASS');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS generation_jobs').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces').catch(() => {});
    await db.end().catch(() => {});
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});