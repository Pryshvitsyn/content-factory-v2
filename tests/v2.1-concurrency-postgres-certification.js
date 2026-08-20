'use strict';

const { Client } = require('pg');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WORKERS = 8;
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

async function setupDatabase(db) {
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS generation_jobs CASCADE');
  await db.query('DROP TABLE IF EXISTS workspaces CASCADE');
  await db.query('CREATE TABLE workspaces (id uuid PRIMARY KEY, name text NOT NULL)');
  await db.query('CREATE TABLE generation_jobs (id uuid PRIMARY KEY)');
  await db.query(
    'INSERT INTO workspaces(id,name) VALUES ($1,$2)',
    ['00000000-0000-0000-0000-000000000032', 'concurrency-cert']
  );

  await db.query(fs.readFileSync(path.join(root, 'migrations/002_v2_1_execution.sql'), 'utf8'));
  await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_stage_input_propagation.sql'), 'utf8'));
  await db.query(fs.readFileSync(path.join(root, 'migrations/20260819_v2_1_retry_recovery.sql'), 'utf8'));
}

async function setup(db) {
  const workspace = await db.query('SELECT id FROM workspaces LIMIT 1');
  if (!workspace.rowCount) throw new Error('No workspace available for concurrency certification');
  const workspaceId = workspace.rows[0].id;
  const productionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  await db.query(
    `INSERT INTO v2_1.productions(id, workspace_id, name, status, metadata)
     VALUES ($1,$2,$3,'DRAFT','{}')`,
    [productionId, workspaceId, `concurrency-cert-${productionId}`]
  );
  await db.query(
    `INSERT INTO v2_1.jobs(id, production_id, stage, idempotency_key, status)
     VALUES ($1,$2,'SIGNAL',$3,'QUEUED')`,
    [jobId, productionId, `concurrency-job-${jobId}`]
  );
  return { workspaceId, productionId, jobId };
}

async function raceClaims(jobId) {
  const clients = Array.from({ length: WORKERS }, () => client());
  await Promise.all(clients.map((c) => c.connect()));
  try {
    return await Promise.all(clients.map(async (c, i) => {
      const productionId = (await c.query('SELECT production_id FROM v2_1.jobs WHERE id=$1', [jobId])).rows[0].production_id;
      const result = await c.query('SELECT * FROM v2_1.claim_job_for_production($1,$2,$3,$4)', [
        jobId,
        productionId,
        `cert-worker-${i}`,
        30,
      ]);
      return result.rows[0] || null;
    }));
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function main() {
  const db = client();
  await db.connect();
  try {
    await setupDatabase(db);
    const { jobId } = await setup(db);
    const claims = await raceClaims(jobId);
    const successfulClaims = claims.filter(Boolean);

    if (successfulClaims.length !== 1) {
      throw new Error(`Concurrency certification failed: expected exactly 1 successful job claim, got ${successfulClaims.length}`);
    }

    const owner = successfulClaims[0].worker_id;
    const job = await db.query('SELECT status, worker_id FROM v2_1.jobs WHERE id=$1', [jobId]);
    if (job.rows[0].status !== 'RUNNING' || job.rows[0].worker_id !== owner) {
      throw new Error('Concurrency certification failed: persisted job ownership is inconsistent');
    }

    const stageClaims = [];
    const stageClients = Array.from({ length: WORKERS }, () => client());
    await Promise.all(stageClients.map((c) => c.connect()));
    try {
      await Promise.all(stageClients.map((c, i) => c.query(
        'SELECT * FROM v2_1.claim_stage($1,$2,$3)', [jobId, owner, 30]
      ).then((r) => stageClaims.push(...r.rows.map((row) => ({ ...row, contender: i })) ))));
    } finally {
      await Promise.all(stageClients.map((c) => c.end()));
    }

    if (stageClaims.length !== 1) {
      throw new Error(`Concurrency certification failed: expected exactly 1 successful stage claim, got ${stageClaims.length}`);
    }

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
