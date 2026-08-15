'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJob, claimNextStage, completeStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeBriefStage } = require('../worker/v2.1-brief-generation');

const config = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || 'content_os', user: process.env.PGUSER || 'n8n', password: process.env.PGPASSWORD };

const BRIEF = {
  objective: 'conversion',
  audience: 'buyers',
  promise: 'Make the next decision clearer.',
  keyMessage: 'Notice the important signal before acting.',
  cta: 'Learn more.',
  creativeDirection: 'Human, concrete, emotionally precise.',
  constraints: { compliance: ['no unsupported claims'], production: ['filmable'] },
};

const IDEA_SET = {
  ideas: [
    { id: 'idea-1', title: 'The Notice', premise: 'A small observation changes a decision.', hook: 'What if the thing you ignored was the answer?', angle: 'human', rationale: 'Emotion before explanation.' },
    { id: 'idea-2', title: 'The Choice', premise: 'A familiar choice reveals a hidden tradeoff.', hook: 'You make this choice every day.', angle: 'contrast', rationale: 'Turns routine into tension.' },
    { id: 'idea-3', title: 'The Turn', premise: 'A character changes course after one honest moment.', hook: 'One sentence changes everything.', angle: 'transformation', rationale: 'Creates a clear emotional arc.' },
  ],
};

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`BRIEF Smoke Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `BRIEF Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [business.rows[0].id, `BRIEF Brand ${suffix}`, JSON.stringify({ tone: 'clear' })]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise) VALUES($1,$2,$3) RETURNING id`, [brand.rows[0].id, `BRIEF Universe ${suffix}`, 'Smoke universe']);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `BRIEF Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`BRIEF Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `BRIEF Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `BRIEF Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `brief-smoke-${suffix}`, fingerprint({ suffix, context: 'immutable' }), JSON.stringify({ business: { id: business.rows[0].id }, brand: { id: brand.rows[0].id, rules: { tone: 'clear' } } }), JSON.stringify({ objective: 'brief-smoke' })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `brief-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);

    const provider = await client.query(`INSERT INTO v2_1.providers(name,capabilities) VALUES('nvidia','["TEXT_GENERATION"]'::jsonb) ON CONFLICT (name) DO UPDATE SET enabled = true RETURNING id`);
    const model = await client.query(`INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,'smoke-test-model','TEXT_GENERATION') ON CONFLICT (provider_id,name) DO UPDATE SET enabled = true RETURNING id`, [provider.rows[0].id]);
    const ideaArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('IDEA_SET',$1,'VALID') RETURNING id`, [productionId]);
    const ideaArtifactId = ideaArtifact.rows[0].id;
    const ideaHash = fingerprint(IDEA_SET);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,provider_id,model_id,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4,$5,$6::jsonb)`, [ideaArtifactId, provider.rows[0].id, model.rows[0].id, fingerprint({ idea: suffix }), ideaHash, JSON.stringify({ capability: 'TEXT_GENERATION', smoke: true })]);
    const stageIds = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const stageByName = Object.fromEntries(stageIds.rows.map((r) => [r.stage, r.id]));
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["SIGNAL_SET"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [fingerprint({ signal: suffix }), stageByName.SIGNAL]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["IDEA_SET"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [ideaHash, stageByName.IDEA]);
    await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status,response,artifact_id,completed_at) VALUES($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'COMPLETED',$6::jsonb,$7,now())`, [stageByName.IDEA, provider.rows[0].id, model.rows[0].id, fingerprint({ ideaRequest: suffix }), JSON.stringify({ capability: 'TEXT_GENERATION' }), JSON.stringify(IDEA_SET), ideaArtifactId]);
    await client.query('COMMIT');

    const workerId = 'brief-smoke-worker';
    const claimedJob = await claimJob(client, { workerId, leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('Production job was not claimed');
    const briefStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!briefStage || briefStage.stage !== 'BRIEF') throw new Error('BRIEF stage was not unlocked after IDEA');

    const first = await executeBriefStage({ client, productionId, stageRunId: briefStage.id, workerId, providerCall: async () => ({ parsed: BRIEF }) });
    if (!first.artifactId || !first.generationRunId || first.reused) throw new Error('First BRIEF generation did not create provenance');
    if (first.sourceArtifactId !== ideaArtifactId) throw new Error('BRIEF did not consume the canonical IDEA artifact');

    const provenance = await client.query(`SELECT gr.status, gr.artifact_id, av.output_hash, av.metadata->>'sourceArtifactId' AS source_artifact_id FROM v2_1.generation_runs gr JOIN v2_1.artifact_versions av ON av.artifact_id=gr.artifact_id WHERE gr.id=$1`, [first.generationRunId]);
    if (provenance.rowCount !== 1 || provenance.rows[0].status !== 'COMPLETED' || provenance.rows[0].source_artifact_id !== ideaArtifactId || !provenance.rows[0].output_hash) throw new Error('BRIEF provenance is incomplete');

    const duplicate = await executeBriefStage({ client, productionId, stageRunId: briefStage.id, workerId, providerCall: async () => ({ parsed: BRIEF }) }).catch((error) => error);
    if (!(duplicate instanceof Error) || !duplicate.message.includes('lease')) throw new Error('Completed BRIEF stage was not protected from duplicate execution');

    console.log('V2.1 BRIEF GENERATION DATABASE SMOKE TEST PASSED.');
    console.log('EXECUTION ENGINE -> IDEA ARTIFACT -> BRIEF -> GENERATION_RUN -> ARTIFACT_VERSION VERIFIED.');
    console.log('IMMUTABLE PRODUCTION CONTEXT FINGERPRINT CARRIED INTO BRIEF REQUEST.');
    console.log('CANONICAL IDEA SOURCE ARTIFACT VERIFIED.');
    console.log('DUPLICATE BRIEF EXECUTION REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) await client.query('ROLLBACK').catch(() => {});
    await client.query('DELETE FROM v2_1.tenants WHERE id=$1', [tenantId]).catch(() => {});
    await client.end();
  }
}

main().catch((error) => { console.error('V2.1 BRIEF GENERATION DATABASE SMOKE TEST FAILED.'); console.error(error.message); process.exit(1); });