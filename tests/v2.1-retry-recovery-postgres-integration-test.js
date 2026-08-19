'use strict';

const assert = require('node:assert/strict');
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

async function run() {
  const db = client();
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
    await db.query(fs.readFileSync(path.join(root, 'migrations/002_v2_1_execution.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_stage_input_propagation.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_retry_recovery.sql'), 'utf8'));

    await db.query(`
      CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, name text NOT NULL);
      INSERT INTO workspaces(id,name) VALUES ('00000000-0000-0000-0000-000000000031','retry-recovery-cert')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO v2_1.productions(workspace_id,idempotency_key,status,immutable_context)
      VALUES ('00000000-0000-0000-0000-000000000031',$1,'DRAFT','{}')
    `, [`retry-prod-${process.pid}`]);

    const production = (await db.query(
      `SELECT id FROM v2_1.productions WHERE workspace_id='00000000-0000-0000-0000-000000000031' ORDER BY created_at DESC LIMIT 1`
    )).rows[0];

    await db.query(`
      INSERT INTO v2_1.jobs(production_id,workspace_id,idempotency_key,status,max_attempts)
      VALUES ($1,'00000000-0000-0000-0000-000000000031',$2,'QUEUED',3)
    `, [production.id, `retry-job-${process.pid}`]);

    const job = (await db.query(
      `SELECT id FROM v2_1.jobs WHERE production_id=$1 ORDER BY created_at DESC LIMIT 1`, [production.id]
    )).rows[0];

    await execution.claimJobForProduction(db, {
      jobId: job.id,
      productionId: production.id,
      workerId: 'retry-worker-a',
      leaseSeconds: 5,
    });

    const first = await execution.claimNextStage(db, {
      jobId: job.id,
      workerId: 'retry-worker-a',
      leaseSeconds: 5,
    });
    assert.equal(first.stage, 'SIGNAL');

    await db.query(`UPDATE v2_1.stage_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [first.id]);

    const recovered = await execution.recoverExpiredWork(db);
    assert.equal(recovered.stages_recovered, 1);

    const attempts = (await db.query(`
      SELECT attempt,status,input_artifacts,input_fingerprint
      FROM v2_1.stage_runs WHERE job_id=$1 AND stage='SIGNAL' ORDER BY attempt
    `, [job.id])).rows;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'FAILED');
    assert.equal(attempts[1].status, 'RETRYING');
    assert.deepEqual(attempts[1].input_artifacts, attempts[0].input_artifacts);
    assert.equal(attempts[1].input_fingerprint, attempts[0].input_fingerprint);

    const second = await execution.claimNextStage(db, {
      jobId: job.id,
      workerId: 'retry-worker-a',
      leaseSeconds: 5,
    });
    assert.equal(second.stage, 'SIGNAL');
    assert.equal(second.attempt, 2);

    await execution.completeStage(db, {
      stageRunId: second.id,
      workerId: 'retry-worker-a',
      outputArtifacts: ['retry-signal-output'],
      outputFingerprint: execution.fingerprint(['retry-signal-output']),
    });

    const next = await execution.claimNextStage(db, {
      jobId: job.id,
      workerId: 'retry-worker-a',
      leaseSeconds: 5,
    });
    assert.equal(next.stage, 'IDEA');
    assert.deepEqual(next.input_artifacts, ['retry-signal-output']);

    console.log('V2.1 PostgreSQL retry + lease recovery + continuation: PASS');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces').catch(() => {});
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
