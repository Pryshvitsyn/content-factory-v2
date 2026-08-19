'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
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
  });
}

async function main() {
  const admin = client();
  let a;
  let b;
  let c;
  let d;
  await admin.connect();

  try {
    await admin.query(`
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
    `);

    for (const migration of migrations) {
      await admin.query(fs.readFileSync(path.join(root, migration), 'utf8'));
    }

    await admin.query(`
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
    `);

    const job = (await admin.query(`
      SELECT j.id, j.production_id
      FROM v2_1.jobs j
      JOIN v2_1.productions p ON p.id=j.production_id
      WHERE p.idempotency_key='cert-production' AND j.idempotency_key='cert-job'
    `)).rows[0];
    assert.ok(job, 'certification job must exist');

    // Two independent workers race for one job: exactly one may win.
    a = client();
    b = client();
    await Promise.all([a.connect(), b.connect()]);
    const claims = await Promise.all([
      a.query(`SELECT * FROM v2_1.claim_job($1,$2)`, ['worker-a', 30]),
      b.query(`SELECT * FROM v2_1.claim_job($1,$2)`, ['worker-b', 30]),
    ]);
    const winners = claims.flatMap((r) => r.rows);
    assert.equal(winners.length, 1, 'exactly one worker must claim a job');
    assert.equal(winners[0].status, 'RUNNING');
    await Promise.all([a.end(), b.end()]);
    a = null;
    b = null;

    const owner = winners[0].worker_id;
    assert.ok(['worker-a', 'worker-b'].includes(owner));

    // Two concurrent calls using the legitimate job owner must still produce
    // exactly one stage run. The database lock, not worker identity, provides
    // the concurrency guarantee; a non-owner must be rejected separately.
    c = client();
    d = client();
    await Promise.all([c.connect(), d.connect()]);
    const stageClaims = await Promise.all([
      c.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, owner, 30]),
      d.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, owner, 30]),
    ]);
    const stageWinners = stageClaims.flatMap((r) => r.rows);
    assert.equal(stageWinners.length, 1, 'exactly one worker must claim the next stage');
    assert.equal(stageWinners[0].stage, 'SIGNAL');
    assert.equal(
      (await admin.query(`SELECT count(*)::int AS n FROM v2_1.stage_runs WHERE job_id=$1 AND stage='SIGNAL'`, [job.id])).rows[0].n,
      1,
      'concurrent stage claim must create exactly one stage run'
    );

    const nonOwner = owner === 'worker-a' ? 'worker-b' : 'worker-a';
    const nonOwnerClaim = await admin.query(
      `SELECT * FROM v2_1.claim_stage($1,$2,$3)`,
      [job.id, nonOwner, 30]
    );
    assert.equal(nonOwnerClaim.rows.length, 0, 'non-owner must not claim a stage');

    await Promise.all([c.end(), d.end()]);
    c = null;
    d = null;

    // Ownership is enforced for heartbeat.
    const stageRunId = stageWinners[0].id;
    const heartbeatWrong = await admin.query(
      `SELECT v2_1.heartbeat_stage($1,$2,$3) AS renewed`,
      [stageRunId, nonOwner, 30]
    );
    assert.equal(heartbeatWrong.rows[0].renewed, false);

    const heartbeatRight = await admin.query(
      `SELECT v2_1.heartbeat_stage($1,$2,$3) AS renewed`,
      [stageRunId, owner, 30]
    );
    assert.equal(heartbeatRight.rows[0].renewed, true);

    // Completing SIGNAL makes IDEA the only legal next stage.
    await admin.query(`
      UPDATE v2_1.stage_runs
         SET status='COMPLETED', worker_id=NULL, lease_expires_at=NULL, completed_at=now()
       WHERE id=$1
    `, [stageRunId]);
    const next = await admin.query(`SELECT * FROM v2_1.claim_stage($1,$2,$3)`, [job.id, owner, 30]);
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0].stage, 'IDEA');

    // Recovery turns an expired running stage into RETRYING and clears ownership.
    await admin.query(`
      UPDATE v2_1.stage_runs
         SET lease_expires_at=now()-interval '1 second'
       WHERE id=$1
    `, [next.rows[0].id]);
    const recovery = await admin.query(`SELECT * FROM v2_1.recover_expired_work()`);
    assert.equal(recovery.rows[0].stages_recovered, 1);
    const recovered = (await admin.query(`SELECT status, worker_id, lease_expires_at FROM v2_1.stage_runs WHERE id=$1`, [next.rows[0].id])).rows[0];
    assert.equal(recovered.status, 'RETRYING');
    assert.equal(recovered.worker_id, null);
    assert.equal(recovered.lease_expires_at, null);

    // Recovery contract advances the retry attempt without retaining a worker lease.
    const retryAttempt = (await admin.query(`SELECT attempt FROM v2_1.stage_runs WHERE id=$1`, [next.rows[0].id])).rows[0].attempt;
    assert.equal(retryAttempt, 2, 'recovered stage must advance to attempt 2');

    // Production idempotency is database-enforced.
    await assert.rejects(
      admin.query(`
        INSERT INTO v2_1.productions(workspace_id, idempotency_key)
        VALUES ('00000000-0000-0000-0000-000000000001','cert-production')
      `),
      /duplicate key|unique/i
    );

    console.log('V2.1 PostgreSQL execution/concurrency certification: PASS');
  } finally {
    for (const connection of [a, b, c, d]) {
      if (connection) {
        try { await connection.end(); } catch (_) { /* best effort cleanup */ }
      }
    }
    await admin.query(`DROP SCHEMA IF EXISTS v2_1 CASCADE`);
    await admin.query(`DROP TABLE IF EXISTS generation_jobs`);
    await admin.query(`DROP TABLE IF EXISTS workspaces`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
