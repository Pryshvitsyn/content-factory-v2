'use strict';

const { Client } = require('pg');
require('dotenv').config();

const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeShotPlanStage } = require('../worker/v2.1-shot-plan');
const { executeAssetPlanStage } = require('../worker/v2.1-asset-plan');

const config = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || 'content_os', user: process.env.PGUSER || 'n8n', password: process.env.PGPASSWORD };
const SCRIPT = { title: 'Planning Smoke', scenes: [{ purpose: 'setup', visual: 'A person enters', action: 'Enter', dialogue: 'Hello', audio: 'Room tone' }, { purpose: 'choice', visual: 'The person notices a detail', action: 'Turn', dialogue: 'I see it', audio: 'Resolve' }] };
const BIBLE = { creativeTruth: { concept: 'A person notices a detail before making a choice.' }, productionPlan: { shots: [{ number: 1, description: 'Setup', action: 'Enter', durationMs: 3000, assetRefs: [{ id: 'character-main', type: 'CHARACTER', version: 1 }] }, { number: 2, description: 'Choice', action: 'Turn', durationMs: 4000, continuityRequirements: ['same identity'], assetRefs: [{ id: 'character-main', type: 'CHARACTER', version: 1 }] }], assetRequirements: [{ id: 'character-main', role: 'main-character', type: 'CHARACTER', version: 1 }, { id: 'location-main', role: 'main-location', type: 'LOCATION', version: 1 }] } };

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  try {
    const suffix = Date.now().toString();
    const context = { tenant: { id: `tenant-${suffix}` }, business: { id: `business-${suffix}` }, brand: { id: `brand-${suffix}` }, strategy: { id: `strategy-${suffix}`, version: 1 } };
    const contextFingerprint = fingerprint(context);
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Planning Smoke ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Planning Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,'{}'::jsonb) RETURNING id`, [business.rows[0].id, `Planning Brand ${suffix}`]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise) VALUES($1,$2,$3) RETURNING id`, [brand.rows[0].id, `Planning Universe ${suffix}`, 'Planning']);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `Planning Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`Planning Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Planning Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Planning Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `planning-prod-${suffix}`, contextFingerprint, JSON.stringify(context), JSON.stringify({ signal: { topic: 'planning' } })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `planning-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);

    const provider = await client.query(`INSERT INTO v2_1.providers(name,capabilities) VALUES('nvidia','["TEXT_GENERATION"]'::jsonb) ON CONFLICT(name) DO UPDATE SET enabled=true RETURNING id`);
    const model = await client.query(`INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,'planning-smoke','TEXT_GENERATION') ON CONFLICT(provider_id,name) DO UPDATE SET enabled=true RETURNING id`, [provider.rows[0].id]);
    const scriptArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [productionId]);
    const scriptArtifactId = scriptArtifact.rows[0].id;
    const scriptHash = fingerprint(SCRIPT);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,provider_id,model_id,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4,$5,$6::jsonb)`, [scriptArtifactId, provider.rows[0].id, model.rows[0].id, fingerprint({ suffix, script: true }), scriptHash, JSON.stringify({ sourceArtifactIds: [] })]);
    const scriptStage = (await client.query(`SELECT id FROM v2_1.stage_runs WHERE job_id=$1 AND stage='SCRIPT'`, [jobId])).rows[0].id;
    await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status,response,artifact_id,completed_at) VALUES($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'COMPLETED',$6::jsonb,$7,now())`, [scriptStage, provider.rows[0].id, model.rows[0].id, fingerprint({ request: suffix }), JSON.stringify({ production: { contextFingerprint } }), JSON.stringify(SCRIPT), scriptArtifactId]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["SCRIPT"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [scriptHash, scriptStage]);

    const bibleArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('PRODUCTION_BIBLE',$1,'VALID') RETURNING id`, [productionId]);
    const bibleArtifactId = bibleArtifact.rows[0].id;
    const bibleDocument = { ...BIBLE, context };
    const bibleHash = fingerprint(bibleDocument);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4::jsonb)`, [bibleArtifactId, fingerprint({ bible: suffix }), bibleHash, JSON.stringify({ contractVersion: 1 })]);
    const bibleRow = await client.query(`INSERT INTO v2_1.production_bibles(production_id,version,contract_version,bible_id,context_fingerprint,context_snapshot,document,artifact_id,source_script_artifact_id,source_script_version,source_script_hash) VALUES($1,1,1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,1,$9) RETURNING id`, [productionId, `bible-${suffix}`, contextFingerprint, JSON.stringify(context), JSON.stringify(BIBLE), bibleArtifactId, scriptArtifactId, scriptHash]);
    const bibleId = bibleRow.rows[0].id;
    const bibleStage = (await client.query(`SELECT id FROM v2_1.stage_runs WHERE job_id=$1 AND stage='BIBLE'`, [jobId])).rows[0].id;
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["PRODUCTION_BIBLE"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [bibleHash, bibleStage]);
    for (const stage of ['SIGNAL','IDEA','BRIEF','CONCEPT']) await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts=$1::jsonb,output_fingerprint=$2,completed_at=now() WHERE job_id=$3 AND stage=$4`, [JSON.stringify([stage === 'SIGNAL' ? 'SIGNAL_SET' : stage === 'IDEA' ? 'IDEA_SET' : stage === 'BRIEF' ? 'CONTENT_BRIEF' : 'CONCEPT']), fingerprint({ stage, suffix }), jobId, stage]);

    const workerId = 'planning-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob) throw new Error('Planning production job was not claimable');
    const shotStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!shotStage || shotStage.stage !== 'SHOT_PLAN') throw new Error('SHOT_PLAN was not unlocked after BIBLE');
    const shotResult = await executeShotPlanStage({ client, productionId, stageRunId: shotStage.id, workerId });
    if (!shotResult.artifactId || shotResult.shotCount !== 2) throw new Error('SHOT_PLAN did not persist canonical shots');
    const assetStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!assetStage || assetStage.stage !== 'ASSET_PLAN') throw new Error('ASSET_PLAN was not unlocked after SHOT_PLAN');
    const assetResult = await executeAssetPlanStage({ client, productionId, stageRunId: assetStage.id, workerId });
    if (!assetResult.artifactId || assetResult.requirementCount !== 4) throw new Error('ASSET_PLAN did not persist canonical requirements');

    const durable = await client.query(`SELECT count(*)::integer AS shots, count(*) FILTER (WHERE production_bible_id=$2 AND source_script_artifact_id=$3 AND context_fingerprint=$4)::integer AS valid_shots FROM v2_1.shots WHERE production_id=$1`, [productionId, bibleId, scriptArtifactId, contextFingerprint]);
    if (durable.rows[0].shots !== 2 || durable.rows[0].shots !== durable.rows[0].valid_shots) throw new Error('SHOT_PLAN provenance is incomplete');
    const requirements = await client.query(`SELECT count(*)::integer AS count, count(*) FILTER (WHERE production_bible_id=$2 AND context_fingerprint=$3)::integer AS valid_count FROM v2_1.asset_requirements ar JOIN v2_1.shots s ON s.id=ar.shot_id WHERE s.production_id=$1`, [productionId, bibleId, contextFingerprint]);
    if (requirements.rows[0].count !== 4 || requirements.rows[0].count !== requirements.rows[0].valid_count) throw new Error('ASSET_PLAN provenance is incomplete');
    await assertDatabaseRejects(client, `UPDATE v2_1.shots SET instructions='{"tampered":true}'::jsonb WHERE production_id=$1 AND shot_number=1`, [productionId], /SHOT_PLAN definition is immutable/);

    const secondProduction = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,production_version,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) SELECT content_variant_id,tenant_id,business_id,brand_id,project_id,production_version+1,'RUNNING',$1,$2,context_snapshot,request_snapshot FROM v2_1.productions WHERE id=$3 RETURNING id`, [`planning-second-${suffix}`, contextFingerprint, productionId]);
    await assertDatabaseRejects(client, `INSERT INTO v2_1.shots(production_id,shot_number,duration_ms,instructions,production_bible_id,source_script_artifact_id,context_fingerprint,plan_fingerprint) VALUES($1,99,1000,'{}'::jsonb,$2,$3,$4,$5)`, [secondProduction.rows[0].id, bibleId, scriptArtifactId, contextFingerprint, 'foreign-plan'], /different production BIBLE/);

    console.log('V2.1 PLANNING DATABASE SMOKE TEST PASSED.');
    console.log('BIBLE -> SHOT_PLAN -> ASSET_PLAN DEPENDENCY ORDER VERIFIED.');
    console.log('SHOT PLAN ARTIFACT + DURABLE SHOTS VERIFIED.');
    console.log('ASSET PLAN ARTIFACT + DURABLE REQUIREMENTS VERIFIED.');
    console.log('IMMUTABLE CONTEXT CONTINUITY VERIFIED.');
    console.log('PLANNING DEFINITION IMMUTABILITY VERIFIED.');
    console.log('CROSS-PRODUCTION PLANNING OWNERSHIP REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) {
      await client.query('DELETE FROM v2_1.productions WHERE tenant_id=$1', [tenantId]).catch(() => {});
      await client.query('DELETE FROM v2_1.tenants WHERE id=$1', [tenantId]).catch(() => {});
    }
    await client.end();
  }
}

async function assertDatabaseRejects(client, sql, params, pattern) {
  try { await client.query(sql, params); }
  catch (error) { if (!pattern.test(error.message)) throw error; return; }
  throw new Error(`Expected database rejection matching ${pattern}`);
}

main().catch((error) => {
  console.error('V2.1 PLANNING DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
