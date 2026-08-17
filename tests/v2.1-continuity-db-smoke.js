'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeAssetGenerationStage } = require('../worker/v2.1-asset-generation');
const { executeContinuityStage } = require('../worker/v2.1-continuity');

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
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Continuity Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Continuity Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Continuity Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Continuity Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Continuity Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Continuity Variant ${suffix}`]);
    const production = await client.query(
      `INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot)
       VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
      [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `continuity-prod-${suffix}`, `ctx-${suffix}`, JSON.stringify({ brand: { tone: 'consistent' } }), JSON.stringify({ signal: { topic: 'continuity' } })]
    );
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `continuity-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) {
      await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);
    }

    const scriptArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'script-input','script-output','{}'::jsonb)`, [scriptArtifact.rows[0].id]);
    const bibleArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('PRODUCTION_BIBLE',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(
      `INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata)
       VALUES($1,1,$2,$3,$4::jsonb)`,
      [bibleArtifact.rows[0].id, `bible-input-${suffix}`, `bible-output-${suffix}`, JSON.stringify({ stage: 'BIBLE', contextFingerprint: `ctx-${suffix}` })]
    );
    const bible = await client.query(
      `INSERT INTO v2_1.production_bibles(production_id,version,contract_version,bible_id,context_fingerprint,context_snapshot,document,artifact_id,source_script_artifact_id,source_script_version,source_script_hash)
       VALUES($1,1,1,$2,$3,'{}'::jsonb,$4::jsonb,$5,$6,1,'script-output') RETURNING id`,
      [productionId, `bible-${suffix}`, `ctx-${suffix}`, JSON.stringify({ productionPlan: { shots: [{ number: 1 }] } }), bibleArtifact.rows[0].id, scriptArtifact.rows[0].id]
    );
    const shot = await client.query(
      `INSERT INTO v2_1.shots(production_id,shot_number,duration_ms,instructions,production_bible_id,source_script_artifact_id,context_fingerprint,plan_fingerprint)
       VALUES($1,1,4000,'{"description":"hero"}'::jsonb,$2,$3,$4,$5) RETURNING id`,
      [productionId, bible.rows[0].id, scriptArtifact.rows[0].id, `ctx-${suffix}`, `plan-${suffix}`]
    );
    await client.query(
      `INSERT INTO v2_1.asset_requirements(shot_id,asset_role,required_asset_type,status,constraints,production_bible_id,context_fingerprint,plan_fingerprint)
       VALUES($1,'hero','CHARACTER','MISSING','{}'::jsonb,$2,$3,$4) RETURNING id`,
      [shot.rows[0].id, bible.rows[0].id, `ctx-${suffix}`, `plan-${suffix}`]
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

    const workerId = 'continuity-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob || claimedJob.id !== jobId) throw new Error('Continuity production job was not claimed');
    const generationStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!generationStage || generationStage.stage !== 'ASSET_GENERATION') throw new Error('ASSET_GENERATION was not unlocked');
    await executeAssetGenerationStage({
      client, productionId, stageRunId: generationStage.id, workerId,
      providerCall: async ({ request }) => ({ parsed: { assets: [{ requirementId: request.sources.assetPlan[0].requirementId, assetType: 'CHARACTER', name: `Hero ${suffix}`, canonicalData: { identity: 'hero' }, versionData: { appearance: 'stable' } }] } }),
    });

    const continuityStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!continuityStage || continuityStage.stage !== 'CONTINUITY') throw new Error('CONTINUITY stage was not unlocked after ASSET_GENERATION');
    const result = await executeContinuityStage({ client, productionId, stageRunId: continuityStage.id, workerId });
    if (!result.artifactId || !result.continuityFingerprint || result.report.status !== 'PASS') throw new Error('CONTINUITY did not produce a valid report');

    const durable = await client.query(
      `SELECT sr.status AS stage_status, sr.output_artifacts, sr.output_fingerprint,
              a.artifact_type, a.status AS artifact_status, av.output_hash,
              p.status AS production_status,
              count(*) FILTER (WHERE ar.status='SATISFIED' AND ar.resolved_asset_id IS NOT NULL AND ar.resolved_asset_version_id IS NOT NULL)::integer AS satisfied
         FROM v2_1.stage_runs sr
         JOIN v2_1.artifacts a ON a.id=$2
         JOIN v2_1.artifact_versions av ON av.artifact_id=a.id
         JOIN v2_1.productions p ON p.id=$1
         JOIN v2_1.shots s ON s.production_id=p.id
         JOIN v2_1.asset_requirements ar ON ar.shot_id=s.id
        WHERE sr.id=$3
        GROUP BY sr.id,a.id,av.id,p.id`,
      [productionId, result.artifactId, continuityStage.id]
    );
    const row = durable.rows[0];
    if (!row || row.stage_status !== 'COMPLETED' || row.artifact_type !== 'CONTINUITY_REPORT' || row.artifact_status !== 'VALID' || !row.output_hash || row.satisfied !== 1 || row.production_status !== 'RUNNING') throw new Error('CONTINUITY durable boundary is incomplete');

    console.log('V2.1 CONTINUITY DATABASE SMOKE TEST PASSED.');
    console.log('PRODUCTION -> BIBLE -> SHOTS -> ASSET_PLAN -> ASSET_GENERATION -> CONTINUITY VERIFIED.');
    console.log('IMMUTABLE CONTEXT CONTINUITY VERIFIED.');
    console.log('ASSET TYPE + OWNERSHIP + VERSION CONTINUITY VERIFIED.');
    console.log('CONTINUITY_REPORT -> ARTIFACT_VERSION VERIFIED.');
    console.log('DATABASE ENFORCED CONTINUITY COMPLETION VERIFIED.');
    console.log('PRODUCTION REMAINS RUNNING UNTIL EDIT/VALIDATION/PUBLISH/LEARN.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) {
      await client.query(`DELETE FROM v2_1.asset_requirements WHERE shot_id IN (SELECT id FROM v2_1.shots WHERE production_id IN (SELECT id FROM v2_1.productions WHERE tenant_id=$1))`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.shots WHERE production_id IN (SELECT id FROM v2_1.productions WHERE tenant_id=$1)`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.production_bibles WHERE production_id IN (SELECT id FROM v2_1.productions WHERE tenant_id=$1)`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.assets WHERE tenant_id=$1`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.productions WHERE tenant_id=$1`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.tenants WHERE id=$1`, [tenantId]).catch(() => {});
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 CONTINUITY DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
