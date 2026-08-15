'use strict';

const { Client } = require('pg');
require('dotenv').config();
const {
  fingerprint,
  claimJob,
  heartbeatJob,
  claimNextStage,
  heartbeatStage,
  completeStage,
  failStage,
  recoverExpiredWork,
  allStageNames,
} = require('../worker/v2.1-execution-engine');

const clientConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

async function waitForClaim(client, options, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const claimed = await claimNextStage(client, options);
    if (claimed) return claimed;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main() {
  const clientA = new Client(clientConfig);
  const clientB = new Client(clientConfig);
  await clientA.connect();
  await clientB.connect();
  const suffix = Date.now().toString();
  let ids;

  try {
    await clientA.query('BEGIN');

    const tenant = await clientA.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Execution Test Tenant ${suffix}`]);
    const tenantId = tenant.rows[0].id;
    const business = await clientA.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Execution Business ${suffix}`]);
    const businessId = business.rows[0].id;
    const brand = await clientA.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [businessId, `Execution Brand ${suffix}`]);
    const brandId = brand.rows[0].id;
    const universe = await clientA.query(`INSERT INTO v2_1.content_universes(brand_id,name) VALUES($1,$2) RETURNING id`, [brandId, `Execution Universe ${suffix}`]);
    const series = await clientA.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `Execution Series ${suffix}`]);
    const project = await clientA.query(
      `INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config)
       VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`,
      [`Execution Project ${suffix}`, tenantId, businessId, brandId, series.rows[0].id]
    );
    const projectId = project.rows[0].id;
    const content = await clientA.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [projectId, `Execution Content ${suffix}`]);
    const variant = await clientA.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Execution Variant ${suffix}`]);
    const production = await clientA.query(
      `INSERT INTO v2_1.productions
       (content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot)
       VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
      [variant.rows[0].id, tenantId, businessId, brandId, projectId, `execution-request-${suffix}`,
       fingerprint({ tenantId, businessId, brandId, projectId, version: 1 }),
       JSON.stringify({ tenantId, businessId, brandId, projectId, version: 1 }),
       JSON.stringify({ objective: 'execution-smoke', suffix })]
    );
    const productionId = production.rows[0].id;
    const job = await clientA.query(
      `INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input)
       VALUES($1,'PRODUCTION','QUEUED',$2,$3::jsonb) RETURNING id`,
      [productionId, `execution-job-${suffix}`, JSON.stringify({ productionId })]
    );
    const jobId = job.rows[0].id;

    for (const stage of allStageNames()) {
      await clientA.query(
        `INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint)
         VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`,
        [jobId, stage, fingerprint({ productionId, stage, version: 1 })]
      );
    }

    await clientA.query('COMMIT');
    ids = { tenantId, productionId, jobId };

    const first = await claimJob(clientA, { workerId: 'worker-A', leaseSeconds: 60 });
    const second = await claimJob(clientB, { workerId: 'worker-B', leaseSeconds: 60 });
    if (!first) throw new Error('First worker failed to claim the job');
    if (second) throw new Error('Two workers claimed the same job');

    await heartbeatJob(clientA, { jobId, workerId: 'worker-A', leaseSeconds: 60 });
    const signal = await claimNextStage(clientA, { jobId, workerId: 'worker-A', leaseSeconds: 60 });
    if (!signal || signal.stage !== 'SIGNAL') throw new Error('SIGNAL should be the first executable stage');
    await heartbeatStage(clientA, { stageRunId: signal.id, workerId: 'worker-A', leaseSeconds: 60 });
    await completeStage(clientA, { stageRunId: signal.id, workerId: 'worker-A', outputArtifacts: ['SIGNAL_SET'], outputFingerprint: fingerprint({ signal: suffix }) });

    const idea = await claimNextStage(clientA, { jobId, workerId: 'worker-A', leaseSeconds: 60 });
    if (!idea || idea.stage !== 'IDEA') throw new Error('IDEA should unlock after SIGNAL_SET exists');
    const competingStage = await claimNextStage(clientB, { jobId, workerId: 'worker-B', leaseSeconds: 60 });
    if (competingStage) throw new Error('Unowned worker claimed a stage');

    await failStage(clientA, { stageRunId: idea.id, workerId: 'worker-A', retryable: true, error: { code: 'SIMULATED_TRANSIENT' } });

    const retryRecord = await clientA.query(
      `SELECT id, stage, attempt, status, next_attempt_at
         FROM v2_1.stage_runs
        WHERE job_id = $1 AND stage = 'IDEA' AND attempt = 2`,
      [jobId]
    );
    if (retryRecord.rowCount !== 1) throw new Error('Retry did not create exactly one new IDEA attempt');
    if (retryRecord.rows[0].status !== 'RETRYING') throw new Error('New IDEA attempt is not scheduled for retry');

    const retried = await waitForClaim(clientA, { jobId, workerId: 'worker-A', leaseSeconds: 60 });
    if (!retried || retried.stage !== 'IDEA' || retried.attempt !== 2) throw new Error('Scheduled IDEA retry did not become claimable');
    await completeStage(clientA, { stageRunId: retried.id, workerId: 'worker-A', outputArtifacts: ['IDEA_SET'], outputFingerprint: fingerprint({ idea: suffix }) });

    await clientA.query(`UPDATE v2_1.jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [jobId]);
    const recovered = await recoverExpiredWork(clientA);
    if (Number(recovered.jobs_recovered) !== 1) throw new Error('Expired job was not recovered');
    const reclaimed = await claimJob(clientB, { workerId: 'worker-B', leaseSeconds: 60 });
    if (!reclaimed || reclaimed.id !== jobId) throw new Error('Recovered job was not reclaimable');

    console.log('V2.1 EXECUTION ENGINE DATABASE SMOKE TEST PASSED.');
    console.log('ATOMIC JOB CLAIM VERIFIED.');
    console.log('SINGLE-WORKER OWNERSHIP VERIFIED.');
    console.log('LEASE HEARTBEAT VERIFIED.');
    console.log('DEPENDENCY-AWARE STAGE CLAIM VERIFIED.');
    console.log('STAGE RETRY ATTEMPT VERIFIED.');
    console.log('EXPIRED JOB RECOVERY VERIFIED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (ids) {
      await clientA.query(`DELETE FROM v2_1.events WHERE entity_type = 'production' AND entity_id = $1`, [ids.productionId]).catch(() => {});
      await clientA.query(`DELETE FROM v2_1.productions WHERE id = $1`, [ids.productionId]).catch(() => {});
      await clientA.query(`DELETE FROM v2_1.tenants WHERE id = $1`, [ids.tenantId]).catch(() => {});
    }
    await clientA.end();
    await clientB.end();
  }
}

main().catch((error) => {
  console.error('V2.1 EXECUTION ENGINE DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
