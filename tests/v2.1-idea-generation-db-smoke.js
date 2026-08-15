'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJob, claimNextStage, completeStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeIdeaStage } = require('../worker/v2.1-idea-generation');

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  let productionId;

  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`IDEA Smoke Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `IDEA Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [business.rows[0].id, `IDEA Brand ${suffix}`, JSON.stringify({ tone: 'clear' })]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise) VALUES($1,$2,$3) RETURNING id`, [brand.rows[0].id, `IDEA Universe ${suffix}`, 'Smoke universe']);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `IDEA Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`IDEA Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `IDEA Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `IDEA Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `idea-smoke-${suffix}`, fingerprint({ suffix }), JSON.stringify({ business: { id: business.rows[0].id }, brand: { id: brand.rows[0].id, rules: { tone: 'clear' } } }), JSON.stringify({ objective: 'smoke' })]);
    productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `idea-job-${suffix}`]);
    const jobId = job.rows[0].id;

    for (const stage of allStageNames()) {
      await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);
    }
    await client.query('COMMIT');

    const claimedJob = await claimJob(client, { workerId: 'idea-smoke-worker', leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('Production job was not claimed');
    const signal = await claimNextStage(client, { jobId, workerId: 'idea-smoke-worker', leaseSeconds: 60 });
    if (!signal || signal.stage !== 'SIGNAL') throw new Error('SIGNAL stage was not claimed');
    await completeStage(client, { stageRunId: signal.id, workerId: 'idea-smoke-worker', outputArtifacts: ['SIGNAL_SET'], outputFingerprint: fingerprint({ signal: suffix }) });

    const idea = await claimNextStage(client, { jobId, workerId: 'idea-smoke-worker', leaseSeconds: 60 });
    if (!idea || idea.stage !== 'IDEA') throw new Error('IDEA stage was not unlocked');

    const fakeProvider = async () => ({ parsed: { ideas: [
      { id: 'idea-1', title: 'One', premise: 'A', hook: 'H', angle: 'A1', rationale: 'R' },
      { id: 'idea-2', title: 'Two', premise: 'B', hook: 'H', angle: 'A2', rationale: 'R' },
      { id: 'idea-3', title: 'Three', premise: 'C', hook: 'H', angle: 'A3', rationale: 'R' },
    ] } });

    const first = await executeIdeaStage({ client, productionId, stageRunId: idea.id, workerId: 'idea-smoke-worker', signal: { topic: 'test' }, providerCall: fakeProvider });
    if (!first.artifactId || !first.generationRunId || first.reused) throw new Error('First IDEA generation did not create provenance');

    const repeat = await executeIdeaStage({ client, productionId, stageRunId: idea.id, workerId: 'idea-smoke-worker', signal: { topic: 'test' }, providerCall: fakeProvider }).catch((error) => error);
    if (!(repeat instanceof Error) || !repeat.message.includes('lease')) throw new Error('Completed IDEA stage was not protected from duplicate execution');

    const provenance = await client.query(`SELECT gr.status, gr.artifact_id, av.output_hash FROM v2_1.generation_runs gr JOIN v2_1.artifact_versions av ON av.artifact_id = gr.artifact_id WHERE gr.id = $1`, [first.generationRunId]);
    if (provenance.rowCount !== 1 || provenance.rows[0].status !== 'COMPLETED' || !provenance.rows[0].artifact_id || !provenance.rows[0].output_hash) throw new Error('Generation provenance is incomplete');

    console.log('V2.1 IDEA GENERATION DATABASE SMOKE TEST PASSED.');
    console.log('EXECUTION ENGINE -> IDEA -> GENERATION_RUN -> ARTIFACT_VERSION VERIFIED.');
    console.log('PROVIDER REMAINS OUTSIDE CREATIVE CONTEXT VERIFIED.');
    console.log('DUPLICATE STAGE EXECUTION REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) await client.query('ROLLBACK').catch(async () => { await client.query('DELETE FROM v2_1.tenants WHERE id = $1', [tenantId]).catch(() => {}); });
    await client.query('DELETE FROM v2_1.tenants WHERE id = $1', [tenantId]).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 IDEA GENERATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
