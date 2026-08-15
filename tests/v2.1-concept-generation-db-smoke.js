'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJob, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeConceptStage } = require('../worker/v2.1-concept-generation');

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

const BRIEF = {
  objective: 'conversion',
  audience: 'buyers',
  promise: 'Make the next decision clearer.',
  keyMessage: 'Notice the important signal before acting.',
  cta: 'Learn more.',
  creativeDirection: 'Human, concrete, emotionally precise.',
  constraints: { compliance: ['no unsupported claims'], production: ['filmable'] },
};

const CONCEPT = {
  concept: 'The Moment Before the Choice',
  corePromise: 'A small moment of attention can make a meaningful decision clearer.',
  creativeThesis: 'The strongest decision begins when a person notices what they almost ignored.',
  narrativeApproach: 'Start inside a familiar routine, reveal the overlooked signal, then let the character make a visibly different choice.',
  emotionalArc: 'routine -> uncertainty -> recognition -> confidence',
  visualWorld: 'Naturalistic close observation with human-scale environments and restrained visual language.',
  differentiation: 'The concept makes the insight visible through behavior instead of explaining it as a lesson.',
  constraints: { compliance: ['no unsupported claims'], production: ['filmable', 'no required celebrity'] },
};

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`CONCEPT Smoke Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `CONCEPT Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [business.rows[0].id, `CONCEPT Brand ${suffix}`, JSON.stringify({ tone: 'clear' })]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise) VALUES($1,$2,$3) RETURNING id`, [brand.rows[0].id, `CONCEPT Universe ${suffix}`, 'Smoke universe']);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `CONCEPT Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`CONCEPT Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `CONCEPT Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `CONCEPT Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `concept-smoke-${suffix}`, fingerprint({ suffix, context: 'immutable' }), JSON.stringify({ business: { id: business.rows[0].id }, brand: { id: brand.rows[0].id, rules: { tone: 'clear' } }, strategy: { objective: { primary: 'conversion' } } }), JSON.stringify({ objective: 'concept-smoke' })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `concept-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) {
      await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);
    }

    const provider = await client.query(`INSERT INTO v2_1.providers(name,capabilities) VALUES('nvidia','["TEXT_GENERATION"]'::jsonb) ON CONFLICT (name) DO UPDATE SET enabled = true RETURNING id`);
    const model = await client.query(`INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,'smoke-test-model','TEXT_GENERATION') ON CONFLICT (provider_id,name) DO UPDATE SET enabled = true RETURNING id`, [provider.rows[0].id]);
    const briefArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('CONTENT_BRIEF',$1,'VALID') RETURNING id`, [productionId]);
    const briefArtifactId = briefArtifact.rows[0].id;
    const briefHash = fingerprint(BRIEF);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,provider_id,model_id,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4,$5,$6::jsonb)`, [briefArtifactId, provider.rows[0].id, model.rows[0].id, fingerprint({ brief: suffix }), briefHash, JSON.stringify({ capability: 'TEXT_GENERATION', smoke: true })]);

    const stageIds = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const stageByName = Object.fromEntries(stageIds.rows.map((r) => [r.stage, r.id]));
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["SIGNAL_SET"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [fingerprint({ signal: suffix }), stageByName.SIGNAL]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["IDEA_SET"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [fingerprint({ idea: suffix }), stageByName.IDEA]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["CONTENT_BRIEF"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [briefHash, stageByName.BRIEF]);
    await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status,response,artifact_id,completed_at) VALUES($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'COMPLETED',$6::jsonb,$7,now())`, [stageByName.BRIEF, provider.rows[0].id, model.rows[0].id, fingerprint({ briefRequest: suffix }), JSON.stringify({ capability: 'TEXT_GENERATION' }), JSON.stringify(BRIEF), briefArtifactId]);
    await client.query('COMMIT');

    const workerId = 'concept-smoke-worker';
    const claimedJob = await claimJob(client, { workerId, leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('Production job was not claimed');
    const conceptStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!conceptStage || conceptStage.stage !== 'CONCEPT') throw new Error('CONCEPT stage was not unlocked after BRIEF');

    const first = await executeConceptStage({ client, productionId, stageRunId: conceptStage.id, workerId, providerCall: async () => ({ parsed: CONCEPT }) });
    if (!first.artifactId || !first.generationRunId || first.reused) throw new Error('First CONCEPT generation did not create provenance');
    if (first.sourceArtifactId !== briefArtifactId) throw new Error('CONCEPT did not consume the canonical CONTENT_BRIEF artifact');

    const provenance = await client.query(`SELECT gr.status, gr.artifact_id, av.output_hash, av.metadata->>'sourceArtifactId' AS source_artifact_id, av.metadata->>'sourceArtifactVersion' AS source_artifact_version FROM v2_1.generation_runs gr JOIN v2_1.artifact_versions av ON av.artifact_id=gr.artifact_id WHERE gr.id=$1`, [first.generationRunId]);
    if (provenance.rowCount !== 1 || provenance.rows[0].status !== 'COMPLETED' || provenance.rows[0].source_artifact_id !== briefArtifactId || provenance.rows[0].source_artifact_version !== '1' || !provenance.rows[0].output_hash) throw new Error('CONCEPT provenance is incomplete');

    const duplicate = await executeConceptStage({ client, productionId, stageRunId: conceptStage.id, workerId, providerCall: async () => ({ parsed: CONCEPT }) }).catch((error) => error);
    if (!(duplicate instanceof Error) || !duplicate.message.includes('lease')) throw new Error('Completed CONCEPT stage was not protected from duplicate execution');

    console.log('V2.1 CONCEPT GENERATION DATABASE SMOKE TEST PASSED.');
    console.log('EXECUTION ENGINE -> BRIEF ARTIFACT -> CONCEPT -> GENERATION_RUN -> ARTIFACT_VERSION VERIFIED.');
    console.log('IMMUTABLE PRODUCTION CONTEXT FINGERPRINT CARRIED INTO CONCEPT REQUEST.');
    console.log('CANONICAL CONTENT_BRIEF SOURCE ARTIFACT VERIFIED.');
    console.log('DUPLICATE CONCEPT EXECUTION REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    if (tenantId) await client.query('DELETE FROM v2_1.tenants WHERE id=$1', [tenantId]).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 CONCEPT GENERATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
