'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const WORKERS = 8;
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000041';

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function bootstrap(db) {
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');

  // Keep this certification independent from CI test ordering. The V2.1
  // execution migration references the canonical V2 workspace/job identities,
  // so provide only the minimal base identities required by the contract.
  await db.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id uuid PRIMARY KEY
    );
    INSERT INTO workspaces(id, name)
    VALUES ($1, 'concurrency-cert')
    ON CONFLICT (id) DO NOTHING;
  `, [WORKSPACE_ID]);

  await db.query(fs.readFileSync(path.join(root, 'migrations/002_v2_1_execution.sql'), 'utf8'));
  await db.query(fs.readFileSync(path.join(root, 'migrations/20260820_v2_1_concurrency_certification.sql'), 'utf8'));
}

async function setup(db) {
  const productionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  await db.query(
    `INSERT INTO v2_1.productions(id, workspace_id, idempotency_key, status)
     VALUES ($1,$2,$3,'DRAFT')`,
    [productionId, WORKSPACE_ID, `concurrency-cert-${productionId}`]
  );
  await db.query(
    `INSERT INTO v2_1.jobs(id, production_id, workspace_id, idempotency_key, status)
     VALUES ($1,$2,$3,$4,'QUEUED')`,
    [jobId, productionId, WORKSPACE_ID, `concurrency-job-${jobId}`]
  );
  return { productionId, jobId };
}

async function raceJobClaims(jobId, productionId) {
  const clients = Array.from({ length: WORKERS }, () => client());
  await Promise.all(clients.map((c) => c.connect()));
  try {
    return await Promise.all(clients.map(async (c, i) => {
      const result = await c.query(
        'SELECT * FROM v2_1.claim_job_for_production($1,$2,$3,$4)',
        [jobId, productionId, `cert-worker-${i}`, 30]
      );
      return result.rows[0] || null;
    }));
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function raceStageClaims(jobId, owner) {
  const clients = Array.from({ length: WORKERS }, () => client());
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const results = await Promise.all(clients.map((c) =>
      c.query('SELECT * FROM v2_1.claim_stage($1,$2,$3)', [jobId, owner, 30])
    ));
    return results.flatMap((result) => result.rows);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function main() {
  const db = client();
  await db.connect();
  try {
    await bootstrap(db);
    const { productionId, jobId } = await setup(db);

    const claims = await raceJobClaims(jobId, productionId);
    const successfulClaims = claims.filter(Boolean);
    assert.equal(successfulClaims.length, 1, 'exactly one worker must claim the job');

    const owner = successfulClaims[0].worker_id;
    const job = await db.query(
      'SELECT status, worker_id FROM v2_1.jobs WHERE id=$1',
      [jobId]
    );
    assert.equal(job.rows[0].status, 'RUNNING');
    assert.equal(job.rows[0].worker_id, owner);

    const stageClaims = await raceStageClaims(jobId, owner);
    assert.equal(stageClaims.length, 1, 'exactly one worker must claim the runnable stage');

    await db.query(
      `INSERT INTO v2_1.concurrency_certifications
       (scope, subject_id, contender_count, successful_claims, certified, details)
       VALUES ('job-and-stage-claim',$1,$2,2,true,$3::jsonb)`,
      [jobId, WORKERS, JSON.stringify({ job_owner: owner, stage: stageClaims[0].stage })]
    );

    console.log(`V2.1 CONCURRENCY CERTIFICATION PASSED: ${WORKERS} contenders -> exactly 1 job owner and exactly 1 stage owner`);
    console.log(`job=${jobId} worker=${owner} stage=${stageClaims[0].stage}`);
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS generation_jobs').catch(() => {});
    await db.query('DROP TABLE IF EXISTS workspaces').catch(() => {});
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
