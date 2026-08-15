'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeBibleStage } = require('../worker/v2.1-bible-generation');
const { resolveContext } = require('../worker/v2.1-bible-engine');

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

const SCRIPT = {
  title: 'The Moment Before the Choice',
  logline: 'A person notices an overlooked signal before making a familiar decision.',
  hook: 'The important moment happens before the obvious choice.',
  scenes: [
    { sceneNumber: 1, purpose: 'Setup', visual: 'Person in a familiar place', action: 'Pauses', dialogue: 'Wait.', audio: 'Room tone' },
    { sceneNumber: 2, purpose: 'Recognition', visual: 'Close observation', action: 'Looks again', dialogue: 'I almost missed that.', audio: 'Subtle rise' },
    { sceneNumber: 3, purpose: 'Choice', visual: 'Clear deliberate action', action: 'Changes direction', dialogue: 'Now I know.', audio: 'Resolve' },
  ],
};

const BIBLE = {
  creativeTruth: {
    concept: 'A person notices an overlooked signal before making a familiar decision.',
    narrative: { arc: ['setup', 'recognition', 'choice'] },
    brandRules: { forbiddenClaims: ['unsupported claims'] },
    style: { visual: 'naturalistic, human-scale, restrained' },
    characters: [{ id: 'character-main', version: 1, invariants: ['same identity'], definition: { role: 'main' } }],
    locations: [{ id: 'location-main', version: 1, definition: { role: 'primary setting' } }],
    styles: [{ id: 'style-main', version: 1, definition: { camera: 'observational' } }],
  },
  productionPlan: {
    objective: { cta: 'learn' },
    shots: [
      { number: 1, description: 'Setup', durationMs: 4000, action: 'Pause', assetRefs: [{ id: 'character-main', type: 'CHARACTER', version: 1 }] },
      { number: 2, description: 'Recognition', durationMs: 5000, action: 'Look again', assetRefs: [{ id: 'character-main', type: 'CHARACTER', version: 1 }] },
      { number: 3, description: 'Choice', durationMs: 5000, action: 'Change direction', assetRefs: [{ id: 'character-main', type: 'CHARACTER', version: 1 }] },
    ],
    assetRequirements: [{ role: 'main-character', type: 'CHARACTER', id: 'character-main' }],
    editions: [
      { platform: 'TIKTOK', constraints: { aspectRatio: '9:16', maxDurationSec: 60 } },
      { platform: 'YOUTUBE_SHORTS', constraints: { aspectRatio: '9:16', maxDurationSec: 60 } },
    ],
  },
};

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  let secondProductionId;
  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const contextInput = {
      tenant: { id: `tenant-${suffix}`, name: `BIBLE Smoke Tenant ${suffix}` },
      business: { id: `business-${suffix}`, name: `BIBLE Business ${suffix}`, rules: { tone: 'clear' } },
      brand: { id: `brand-${suffix}`, name: `BIBLE Brand ${suffix}`, rules: { brandRules: { forbiddenClaims: ['unsupported claims'] } } },
      audience: { id: `audience-${suffix}`, profile: { intent: 'learn' } },
      strategy: { id: `strategy-${suffix}`, version: 1, objective: { primary: 'conversion' } },
      universe: { id: `universe-${suffix}`, premise: 'Human moments' },
      series: { id: `series-${suffix}`, version: 1, narrativeRules: { pacing: 'measured' } },
      production: { id: `production-${suffix}`, version: 1 },
    };
    const contextFingerprint = resolveContext(contextInput).fingerprint;

    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`BIBLE Smoke Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `BIBLE Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [business.rows[0].id, `BIBLE Brand ${suffix}`, JSON.stringify({ brandRules: { forbiddenClaims: ['unsupported claims'] } })]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise) VALUES($1,$2,$3) RETURNING id`, [brand.rows[0].id, `BIBLE Universe ${suffix}`, 'Human moments']);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name) VALUES($1,$2) RETURNING id`, [universe.rows[0].id, `BIBLE Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`BIBLE Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `BIBLE Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `BIBLE Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `bible-smoke-${suffix}`, contextFingerprint, JSON.stringify(contextInput), JSON.stringify({ signal: { topic: 'smoke' } })]);
    const productionId = production.rows[0].id;

    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `bible-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) {
      await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);
    }

    const provider = await client.query(`INSERT INTO v2_1.providers(name,capabilities) VALUES('nvidia','["TEXT_GENERATION"]'::jsonb) ON CONFLICT (name) DO UPDATE SET enabled=true RETURNING id`);
    const model = await client.query(`INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,'smoke-test-model','TEXT_GENERATION') ON CONFLICT (provider_id,name) DO UPDATE SET enabled=true RETURNING id`, [provider.rows[0].id]);
    const scriptArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [productionId]);
    const scriptArtifactId = scriptArtifact.rows[0].id;
    const scriptHash = fingerprint(SCRIPT);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,provider_id,model_id,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4,$5,$6::jsonb)`, [scriptArtifactId, provider.rows[0].id, model.rows[0].id, fingerprint({ scriptInput: suffix }), scriptHash, JSON.stringify({ generationRunId: 'script-smoke', sourceArtifactIds: [] })]);

    const stageRows = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const stageByName = Object.fromEntries(stageRows.rows.map((r) => [r.stage, r.id]));
    for (const stage of ['SIGNAL','IDEA','BRIEF','CONCEPT']) {
      await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts=$1::jsonb,output_fingerprint=$2,completed_at=now() WHERE id=$3`, [JSON.stringify([stage === 'SIGNAL' ? 'SIGNAL_SET' : stage === 'IDEA' ? 'IDEA_SET' : stage === 'BRIEF' ? 'CONTENT_BRIEF' : 'CONCEPT']), fingerprint({ stage, suffix }), stageByName[stage]]);
    }
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["SCRIPT"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE id=$2`, [scriptHash, stageByName.SCRIPT]);
    await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status,response,artifact_id,completed_at) VALUES($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'COMPLETED',$6::jsonb,$7,now())`, [stageByName.SCRIPT, provider.rows[0].id, model.rows[0].id, fingerprint({ scriptRequest: suffix }), JSON.stringify({ capability: 'TEXT_GENERATION', production: { contextFingerprint } }), JSON.stringify(SCRIPT), scriptArtifactId]);
    await client.query('COMMIT');

    const workerId = 'bible-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('BIBLE production job was not claimed');
    const bibleStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!bibleStage || bibleStage.stage !== 'BIBLE') throw new Error('BIBLE stage was not unlocked after SCRIPT');

    const first = await executeBibleStage({ client, productionId, stageRunId: bibleStage.id, workerId, providerCall: async () => ({ parsed: BIBLE }) });
    if (!first.artifactId || !first.productionBibleId || !first.generationRunId || first.reused) throw new Error('First BIBLE generation did not create durable provenance');
    if (first.sourceScriptArtifactId !== scriptArtifactId) throw new Error('BIBLE did not consume canonical SCRIPT artifact');

    const durable = await client.query(`SELECT pb.id, pb.version, pb.bible_id, pb.context_fingerprint, pb.document_hash, pb.source_script_artifact_id, a.artifact_type FROM v2_1.production_bibles pb JOIN v2_1.artifacts a ON a.id=pb.artifact_id WHERE pb.id=$1`, [first.productionBibleId]);
    if (durable.rowCount !== 1 || durable.rows[0].artifact_type !== 'PRODUCTION_BIBLE' || durable.rows[0].context_fingerprint !== contextFingerprint || durable.rows[0].source_script_artifact_id !== scriptArtifactId || !durable.rows[0].bible_id || !durable.rows[0].document_hash) throw new Error('BIBLE durable database record is incomplete');

    await assertDatabaseRejects(client, `UPDATE v2_1.production_bibles SET bible_id='tampered' WHERE id=$1`, [first.productionBibleId], /Resolved production bibles are immutable/);

    const duplicate = await executeBibleStage({ client, productionId, stageRunId: bibleStage.id, workerId, providerCall: async () => ({ parsed: BIBLE }) }).catch((error) => error);
    if (!(duplicate instanceof Error) || !duplicate.message.includes('lease')) throw new Error('Completed BIBLE stage was not protected from duplicate execution');

    const second = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) SELECT content_variant_id,tenant_id,business_id,brand_id,project_id,'RUNNING',$1,$2,context_snapshot,request_snapshot FROM v2_1.productions WHERE id=$3 RETURNING id`, [`bible-smoke-second-${suffix}`, contextFingerprint, productionId]);
    secondProductionId = second.rows[0].id;
    const foreignSource = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [secondProductionId]);
    await assertDatabaseRejects(client, `INSERT INTO v2_1.production_bibles(production_id,version,contract_version,bible_id,context_fingerprint,context_snapshot,document,artifact_id,source_script_artifact_id,source_script_version,source_script_hash) VALUES($1,1,2,$2,$3,'{}'::jsonb,'{}'::jsonb,$4,$5,1,'x')`, [productionId, `foreign-${suffix}`, contextFingerprint, first.artifactId, foreignSource.rows[0].id], /belongs to a different production/);

    console.log('V2.1 BIBLE GENERATION DATABASE SMOKE TEST PASSED.');
    console.log('EXECUTION ENGINE -> SCRIPT ARTIFACT -> BIBLE -> GENERATION_RUN -> ARTIFACT_VERSION VERIFIED.');
    console.log('IMMUTABLE PRODUCTION CONTEXT FINGERPRINT CARRIED INTO BIBLE VERIFIED.');
    console.log('CANONICAL SCRIPT SOURCE ARTIFACT VERIFIED.');
    console.log('DATABASE BIBLE RECORD + IMMUTABILITY VERIFIED.');
    console.log('CROSS-PRODUCTION BIBLE SOURCE REJECTED.');
    console.log('DUPLICATE BIBLE EXECUTION REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    if (tenantId) await client.query('DELETE FROM v2_1.tenants WHERE id=$1', [tenantId]).catch(() => {});
    await client.end();
  }
}

async function assertDatabaseRejects(client, sql, params, pattern) {
  try {
    await client.query(sql, params);
  } catch (error) {
    if (!pattern.test(error.message)) throw error;
    return;
  }
  throw new Error(`Expected database rejection matching ${pattern}`);
}

main().catch((error) => {
  console.error('V2.1 BIBLE GENERATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
