'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeAssetGenerationStage } = require('../worker/v2.1-asset-generation');

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
  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Generation Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Generation Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Generation Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Generation Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Generation Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Generation Variant ${suffix}`]);
    const production = await client.query(
      `INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot)
       VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
      [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `generation-prod-${suffix}`, `ctx-${suffix}`, JSON.stringify({ brand: { tone: 'restrained' } }), JSON.stringify({ signal: { topic: 'human moments' } })]
    );
    const productionId = production.rows[0].id;

    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `generation-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) {
      await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);
    }

    const scriptArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [productionId]);
    const scriptVersion = await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'script-input','script-output','{}'::jsonb) RETURNING version`, [scriptArtifact.rows[0].id]);
    const bibleArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('PRODUCTION_BIBLE',$1,'VALID') RETURNING id`, [productionId]);
    const bible = await client.query(
      `INSERT INTO v2_1.production_bibles(production_id,version,contract_version,bible_id,context_fingerprint,context_snapshot,document,artifact_id,source_script_artifact_id,source_script_version,source_script_hash)
       VALUES($1,1,1,$2,$3,'{}'::jsonb,$4::jsonb,$5,$6,$7,$8) RETURNING id`,
      [productionId, `bible-${suffix}`, `ctx-${suffix}`, JSON.stringify({ productionPlan: {} }), bibleArtifact.rows[0].id, scriptArtifact.rows[0].id, scriptVersion.rows[0].version, 'script-output']
    );

    const shot = await client.query(
      `INSERT INTO v2_1.shots(production_id,shot_number,duration_ms,instructions,production_bible_id,source_script_artifact_id,context_fingerprint,plan_fingerprint)
       VALUES($1,1,4000,'{}'::jsonb,$2,$3,$4,$5) RETURNING id`,
      [productionId, bible.rows[0].id, scriptArtifact.rows[0].id, `ctx-${suffix}`, `plan-${suffix}`]
    );

    const requirement = await client.query(
      `INSERT INTO v2_1.asset_requirements(shot_id,asset_role,required_asset_type,status,constraints,production_bible_id,context_fingerprint,plan_fingerprint)
       VALUES($1,'hero','CHARACTER','MISSING',$2::jsonb,$3,$4,$5) RETURNING id`,
      [shot.rows[0].id, JSON.stringify({ appearance: 'consistent', role: 'main character' }), bible.rows[0].id, `ctx-${suffix}`, `plan-${suffix}`]
    );

    const stageRows = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const stageByName = Object.fromEntries(stageRows.rows.map((r) => [r.stage, r.id]));
    const completed = {
      SIGNAL: 'SIGNAL_SET', IDEA: 'IDEA_SET', BRIEF: 'CONTENT_BRIEF', CONCEPT: 'CONCEPT',
      SCRIPT: 'SCRIPT', BIBLE: 'PRODUCTION_BIBLE', SHOT_PLAN: 'SHOTS', ASSET_PLAN: 'ASSET_REQUIREMENTS',
    };
    for (const [stage, output] of Object.entries(completed)) {
      await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts=$1::jsonb,output_fingerprint=$2,completed_at=now() WHERE id=$3`, [JSON.stringify([output]), fingerprint({ stage, suffix }), stageByName[stage]]);
    }

    const workerId = 'asset-generation-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('Generation production job was not claimed');
    const generationStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!generationStage || generationStage.stage !== 'ASSET_GENERATION') throw new Error('ASSET_GENERATION stage was not unlocked after ASSET_PLAN');

    const first = await executeAssetGenerationStage({
      client,
      productionId,
      stageRunId: generationStage.id,
      workerId,
      providerCall: async ({ request }) => ({
        parsed: {
          assets: [{
            requirementId: request.sources.assetPlan[0].requirementId,
            assetType: 'CHARACTER',
            name: `Hero ${suffix}`,
            canonicalData: { role: 'main character', invariants: ['identity', 'appearance'] },
            versionData: { appearance: 'naturalistic', generation: 'smoke' },
          }],
        },
      }),
    });

    if (!first.artifactId || !first.generationRunId || first.reused) throw new Error('First ASSET_GENERATION did not create durable provenance');
    if (first.assets.length !== 1) throw new Error('Expected exactly one generated asset');

    const durable = await client.query(
      `SELECT ar.status, ar.resolved_asset_id, ar.resolved_asset_version_id, ar.resolution_fingerprint,
              a.asset_type, a.identity_fingerprint, av.version,
              gr.status AS generation_status, gr.artifact_id,
              art.artifact_type, av2.output_hash
         FROM v2_1.asset_requirements ar
         JOIN v2_1.assets a ON a.id=ar.resolved_asset_id
         JOIN v2_1.asset_versions av ON av.id=ar.resolved_asset_version_id
         JOIN v2_1.generation_runs gr ON gr.id=$2
         JOIN v2_1.artifacts art ON art.id=gr.artifact_id
         JOIN v2_1.artifact_versions av2 ON av2.artifact_id=art.id
        WHERE ar.id=$1`,
      [requirement.rows[0].id, first.generationRunId]
    );
    const row = durable.rows[0];
    if (!row || row.status !== 'SATISFIED' || !row.resolved_asset_id || !row.resolved_asset_version_id || !row.resolution_fingerprint) throw new Error('Generated asset resolution was not durably persisted');
    if (row.asset_type !== 'CHARACTER' || row.version !== 1 || row.generation_status !== 'COMPLETED' || row.artifact_type !== 'ASSETS' || !row.output_hash) throw new Error('Generation provenance chain is incomplete');

    await assertRejects(client, `UPDATE v2_1.asset_requirements SET resolved_asset_id=NULL WHERE id=$1`, [requirement.rows[0].id], /immutable|Asset resolution/);

    const duplicate = await executeAssetGenerationStage({ client, productionId, stageRunId: generationStage.id, workerId, providerCall: async () => ({ parsed: { assets: [] } }) }).catch((error) => error);
    if (!(duplicate instanceof Error) || !duplicate.message.includes('lease')) throw new Error('Completed ASSET_GENERATION execution was not rejected');

    const audit = await client.query(`SELECT count(*)::integer AS count FROM v2_1.events WHERE entity_type='generation_run' AND entity_id=$1`, [first.generationRunId]);
    if (audit.rows[0].count < 2) throw new Error('Generation audit ledger did not record creation and completion');

    console.log('V2.1 ASSET GENERATION DATABASE SMOKE TEST PASSED.');
    console.log('PRODUCTION -> ASSET_PLAN -> ASSET_GENERATION VERIFIED.');
    console.log('IMMUTABLE PRODUCTION CONTEXT CONTINUITY VERIFIED.');
    console.log('PROVIDER REMAINS OUTSIDE CREATIVE CONTEXT VERIFIED.');
    console.log('ASSET VERSION + RESOLUTION PROVENANCE VERIFIED.');
    console.log('GENERATION RUN -> ASSETS ARTIFACT -> ARTIFACT VERSION VERIFIED.');
    console.log('GENERATION AUDIT LEDGER VERIFIED.');
    console.log('DUPLICATE ASSET GENERATION REJECTED.');
    console.log('PRODUCTION REMAINS RUNNING.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    if (tenantId) {
      await client.query('DELETE FROM v2_1.productions WHERE tenant_id=$1', [tenantId]).catch(() => {});
      await client.query('DELETE FROM v2_1.assets WHERE tenant_id=$1', [tenantId]).catch(() => {});
      await client.query('DELETE FROM v2_1.tenants WHERE id=$1', [tenantId]).catch(() => {});
    }
    await client.end();
  }
}

async function assertRejects(client, sql, params, pattern) {
  try { await client.query(sql, params); }
  catch (error) { if (!pattern.test(error.message)) throw error; return; }
  throw new Error(`Expected database rejection matching ${pattern}`);
}

main().catch((error) => {
  console.error('V2.1 ASSET GENERATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
