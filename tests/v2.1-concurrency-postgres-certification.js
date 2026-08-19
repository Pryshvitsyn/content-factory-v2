'use strict';

const { Client } = require('pg');
const crypto = require('node:crypto');

const WORKERS = 8;

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function setup(db) {
  const workspace = await db.query('SELECT id FROM workspaces LIMIT 1');
  if (!workspace.rowCount) throw new Error('No workspace available for concurrency certification');
  const workspaceId = workspace.rows[0].id;
  const productionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  await db.query(
    `INSERT INTO v2_1.productions(id, workspace_id, idempotency_key, status)
     VALUES ($1,$2,$3,'DRAFT')`,
    [productionId, workspaceId, `concurrency-cert-${productionId}`]
  );
  await db.query(
    `INSERT INTO v2_1.jobs(id, production_id, workspace_id, idempotency_key, status)
     VALUES ($1,$2,$3,$4,'QUEUED')`,
    [jobId, productionId, workspaceId, `concurrency-job-${jobId}`]
  );
  return { workspaceId, productionId, jobId };
}

async function raceClaims(jobId) {
  const clients = Array.from({ length: WORKERS }, () => client());
  await Promise.all(clients.map((c) => c.connect()));
  try {
    return await Promise.all(clients.map(async (c, i) => {
      const result = await c.query('SELECT * FROM v2_1.claim_job_for_production($1,$2,$3,$4)', [
        jobId,
        (await c.query('SELECT production_id FROM v2_1.jobs WHERE id=$1', [jobId])).rows[0].production_id,
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
    const { productionId, jobId } = await setup(db);
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
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
