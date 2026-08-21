'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const execution = require('../worker/v2.1-execution-engine');

const root = path.resolve(__dirname, '..');

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function main() {
  const db = client();
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
    await db.query('DROP TABLE IF EXISTS generation_jobs CASCADE');
    await db.query('DROP TABLE IF EXISTS workspaces CASCADE');
    await db.query('CREATE TABLE workspaces (id uuid PRIMARY KEY, name text NOT NULL)');
    await db.query('CREATE TABLE generation_jobs (id uuid PRIMARY KEY)');
    await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [
      '00000000-0000-0000-0000-000000000033',
      'lease-fencing-cert',
    ]);
    await db.query(fs.readFileSync(path.join(root, 'migrations/002_v2_1_execution.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_stage_input_propagation.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_retry_recovery.sql'), 'utf8'));

    const workspaceId = '00000000-0000-0000-0000-000000000033';
    const productionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await db.query(
      `INSERT INTO v2_1.productions(id,workspace_id,name,status,metadata)
       VALUES ($1,$2,$3,'DRAFT','{}')`,
      [productionId, workspaceId, `lease-fencing-${productionId}`]
    );
    await db.query(
      `INSERT INTO v2_1.jobs(id,production_id,stage,idempotency_key,status,max_attempts)
       VALUES ($1,$2,'SIGNAL',$3,'QUEUED',3)`,
      [jobId, productionId, `lease-fencing-job-${jobId}`]
    );

    const owner = 'lease-worker-a';
    const replacement = 'lease-worker-b';
    const claimed = await execution.claimJobForProduction(db, {
      jobId,
      productionId,
      workerId: owner,
      leaseSeconds: 30,
    });
    assert.ok(claimed);

    const stage = await execution.claimNextStage(db, {
      jobId,
      workerId: owner,
      leaseSeconds: 30,
    });
    assert.ok(stage);

    await db.query(
      `UPDATE v2_1.stage_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [stage.id]
    );
    await db.query(
      `UPDATE v2_1.jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [jobId]
    );

    // An expired owner must be fenced even if recovery has not cleared its ownership yet.
    const staleStageCompletion = await execution.completeStage(db, {
      stageRunId: stage.id,
      workerId: owner,
      outputArtifacts: ['stale-output'],
      outputFingerprint: execution.fingerprint(['stale-output']),
    });
    assert.equal(staleStageCompletion, null);

    const staleStageFailure = await execution.failStage(db, {
      stageRunId: stage.id,
      workerId: owner,
      error: { code: 'STALE_OWNER' },
      retryable: true,
    });
    assert.equal(staleStageFailure, null);

    const staleJobCompletion = await execution.completeJob(db, {
      jobId,
      workerId: owner,
    });
    assert.equal(staleJobCompletion, null);

    const recovered = await execution.recoverExpiredWork(db);
    assert.equal(recovered.stages_recovered, 1);

    const reclaimed = await execution.claimJobForProduction(db, {
      jobId,
      productionId,
      workerId: replacement,
      leaseSeconds: 30,
    });
    assert.ok(reclaimed);
    assert.equal(reclaimed.worker_id, replacement);
    assert.equal(reclaimed.status, 'RUNNING');

    const nextStage = await execution.claimNextStage(db, {
      jobId,
      workerId: replacement,
      leaseSeconds: 30,
    });
    assert.ok(nextStage);
    assert.equal(nextStage.attempt, 2);

    const finalJob = (await db.query(
      `SELECT status,worker_id FROM v2_1.jobs WHERE id=$1`,
      [jobId]
    )).rows[0];
    assert.equal(finalJob.status, 'RUNNING');
    assert.equal(finalJob.worker_id, replacement);

    console.log('V2.1 LEASE FENCING CERTIFICATION PASSED: expired owner cannot complete/fail work after lease expiry');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS generation_jobs CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces CASCADE').catch(() => {});
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
