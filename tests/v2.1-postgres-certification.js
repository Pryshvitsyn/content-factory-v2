'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const TEST_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 5_000;
const migrations = [
  'migrations/002_v2_1_execution.sql',
  'migrations/003_v2_1_execution_contract_fix.sql',
  'migrations/004_v2_1_retry_attempt_contract.sql',
];

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
    statement_timeout: QUERY_TIMEOUT_MS,
    lock_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
}

function withTimeout(promise, label, ms = TEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const clients = [];
  const admin = client();
  clients.push(admin);
  await withTimeout(admin.connect(), 'admin connect');

  try {
    await withTimeout(admin.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS workspaces (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        status text NOT NULL DEFAULT 'queued',
        input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        output_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        error_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        provider_id uuid,
        model_id uuid,
        job_type text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz
      );
    `), 'bootstrap schema');

    for (const migration of migrations) {
      await withTimeout(
        admin.query(fs.readFileSync(path.join(root, migration), 'utf8')),
        `migration ${migration}`
      );
    }

    await withTimeout(admin.query(`
      INSERT INTO workspaces(id, name)
      VALUES ('00000000-0000-0000-0000-000000000001', 'v2.1-cert')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO v2_1.productions(workspace_id, idempotency_key, status, immutable_context)
      VALUES ('00000000-0000-0000-0000-000000000001', 'cert-production', 'DRAFT', '{"cert":true}')
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

      INSERT INTO v2_1.jobs(production_id, workspace_id, idempotency_key, status, max_attempts)
      SELECT p.id, p.workspace_id, 'cert-job', 'QUEUED', 3
      FROM v2_1.productions p
      WHERE p.idempotency_key='cert-production'
      ON CONFLICT (production_id, idempotency_key) DO NOTHING;
    `), 'seed certification data');

    const job = (await withTimeout(admin.query(`
      SELECT j.id, j.production_id
      FROM v2_1.jobs j
      JOIN v2_1.productions p ON p.id=j.production_id
      WHERE p.idempotency_key='cert-production' AND j.idempotency_key='cert-job'
    `), 'load certification job')).rows[0];
    assert.ok(job, 'certification job must exist');

    // Two independent workers race for one job: exactly one may win.
    const a = client();
    const b = client();
    clients.push(a, b);
    await withTimeout(Promise.all([a.connect(), b.connect()]), 'job-race connect');
    const claims = await withTimeout(Promise.all([
      a.query(`SELECT * FROM v2_1.claim_job($1,$2)`, ['worker-a', 30]),
      b.query(`SELECT * FROM v2_1.claim_job($1,$2)`, ['worker-b', 30]),
    ]), 'job claim race');
    const winners = claims.flatMap((r) => r.rows);
    assert.equal(winners.length, 1, 'exactly one worker must claim a job');
    assert.equal(winners[0].status, 'RUNNING');
    const owner = winners[0].worker_id;
    assert.ok(['worker-a', 'worker-b'].includes(owner));
    await withTimeout(Promise.all([a.end(), b.end()]), 'job-race cleanup');

    // Stage ownership is tied to the job owner. Race the owner against a
    // different worker; exactly one stage claim may succeed.
    const c = client();
    const d = client();
    clients.push(c, d);
    await withTimeout(Promise.all([c.connect(), d.connect()]), 'stage-race connect');
    const nonOwner = owner === 'worker-a' ? 'worker-b' : 'worker-a';
    const stageClaims = await withTimeout(Promise.all([
      c.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, owner, 30]),
      d.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, nonOwner, 30]),
    ]), 'stage claim race');
    const stageWinners = stageClaims.flatMap((r) => r.rows);
    assert.equal(stageWinners.length, 1, 'exactly one authorized worker must claim the next stage');
    assert.equal(stageWinners[0].stage, 'SIGNAL');
    assert.equal(stageWinners[0].worker_id, owner);
    assert.equal(
      (await withTimeout(admin.query(`SELECT count(*)::int AS n FROM v2_1.stage_runs WHERE job_id=$1 AND stage='SIGNAL'`, [job.id]), 'stage uniqueness check')).rows[0].n,
      1,
      'concurrent stage claim must create exactly one stage run'
    );
    await withTimeout(Promise.all([c.end(), d.end()]), 'stage-race cleanup');

    // Ownership is enforced for heartbeat.
    const stageRunId = stageWinners[0].id;
    const heartbeatWrong = await withTimeout(admin.query(
      `SELECT v2_1.heartbeat_stage($1,$2,$3) AS renewed`,
      [stageRunId, nonOwner, 30]
    ), 'wrong-owner heartbeat');
    assert.equal(heartbeatWrong.rows[0].renewed, false);

    const heartbeatRight = await withTimeout(admin.query(
      `SELECT v2_1.heartbeat_stage($1,$2,$3) AS renewed`,
      [stageRunId, owner, 30]
    ), 'owner heartbeat');
    assert.equal(heartbeatRight.rows[0].renewed, true);

    // Completing SIGNAL makes IDEA the only legal next stage.
    await withTimeout(admin.query(`
      UPDATE v2_1.stage_runs
         SET status='COMPLETED', worker_id=NULL, lease_expires_at=NULL, completed_at=now()
       WHERE id=$1
    `, [stageRunId]), 'complete SIGNAL');
    const next = await withTimeout(admin.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, owner, 30]), 'claim IDEA');
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0].stage, 'IDEA');

    // Recovery turns an expired running stage into RETRYING and clears ownership.
    await withTimeout(admin.query(`
      UPDATE v2_1.stage_runs
         SET lease_expires_at=now()-interval '1 second'
       WHERE id=$1
    `, [next.rows[0].id]), 'expire IDEA');
    const recovery = await withTimeout(admin.query(`SELECT * FROM v2_1.recover_expired_work()`), 'recover expired work');
    assert.equal(recovery.rows[0].stages_recovered, 1);
    const recovered = (await withTimeout(admin.query(`SELECT status, worker_id, lease_expires_at FROM v2_1.stage_runs WHERE id=$1`, [next.rows[0].id]), 'load recovered stage')).rows[0];
    assert.equal(recovered.status, 'RETRYING');
    assert.equal(recovered.worker_id, null);
    assert.equal(recovered.lease_expires_at, null);

    // Production idempotency is database-enforced.
    await assert.rejects(
      withTimeout(admin.query(`
        INSERT INTO v2_1.productions(workspace_id, idempotency_key)
        VALUES ('00000000-0000-0000-0000-000000000001','cert-production')
      `), 'idempotency constraint'),
      /duplicate key|unique/i
    );

    console.log('V2.1 PostgreSQL execution/concurrency certification: PASS');
  } finally {
    // Best-effort cleanup must never leave the certification process hanging.
    await Promise.allSettled(clients.map((c) => c.end()));
    if (admin._connected) {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS v2_1 CASCADE`);
        await admin.query(`DROP TABLE IF EXISTS generation_jobs`);
        await admin.query(`DROP TABLE IF EXISTS workspaces`);
      } catch (_) {
        // The certification result is already determined; connection/process
        // cleanup is handled by the client close above.
      }
    }
  }
}

withTimeout(main(), 'PostgreSQL certification', TEST_TIMEOUT_MS)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
