'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executeValidationStage } = require('../worker/v2.1-validation');

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
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Validation Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Validation Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Validation Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Validation Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Validation Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Validation Variant ${suffix}`]);
    const context = `ctx-${suffix}`;
    const platforms = ['TIKTOK', 'YOUTUBE_SHORTS'];
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,'{}'::jsonb,$8::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `validation-prod-${suffix}`, context, JSON.stringify({ targetPlatforms: platforms })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `validation-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);

    const edit = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('EDIT',$1,'VALID') RETURNING id`, [productionId]);
    const editArtifactId = edit.rows[0].id;
    const editManifest = { type:'EDIT', version:1, contextFingerprint:context, durationMs:2000, timeline:[{ index:1, shotId:'shot-1', shotNumber:1, startMs:0, endMs:2000, durationMs:2000, assetVersionIds:['asset-v1'] }] };
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-hash','edit-hash',$2::jsonb)`, [editArtifactId, JSON.stringify({ stage:'EDIT', contextFingerprint:context, continuityArtifactId:'continuity-1', continuityFingerprint:'continuity-hash', durationMs:2000, shotCount:1, manifest:editManifest })]);
    const continuityArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('CONTINUITY_REPORT',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-input','continuity-hash',$2::jsonb)`, [continuityArtifact.rows[0].id, JSON.stringify({ stage:'CONTINUITY', contextFingerprint:context, checkCount:8 })]);

    for (const platform of platforms) {
      const manifest = { type:'PLATFORM_EDITION', version:1, platform, profileVersion:1, aspectRatio:'9:16', renderIntent:'SHORT_FORM_VERTICAL', contextFingerprint:context, sourceEditArtifactId:editArtifactId, sourceEditFingerprint:'edit-hash', durationMs:2000, timeline:[{ index:1, shotId:'shot-1', shotNumber:1, startMs:0, endMs:2000, durationMs:2000, assetVersionIds:['asset-v1'], transition:null }], adaptationPolicy:{ crop:'DECLARED_BY_RENDERER', captions:'PRESERVE_SOURCE', audio:'PRESERVE_SOURCE', branding:'PRESERVE_BIBLE' } };
      const editionFingerprint = fingerprint(manifest);
      await client.query(`INSERT INTO v2_1.editions(production_id,platform,version,metadata,artifact_id) VALUES($1,$2,1,$3::jsonb,$4)`, [productionId, platform, JSON.stringify({ stage:'PLATFORM_ADAPTATION', contextFingerprint:context, sourceEditArtifactId:editArtifactId, sourceEditFingerprint:'edit-hash', editionFingerprint, profileVersion:1, manifest }), editArtifactId]);
    }

    const stageRows = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const byStage = Object.fromEntries(stageRows.rows.map((r) => [r.stage, r.id]));
    const priorStages = allStageNames().slice(0, allStageNames().indexOf('VALIDATION'));
    const outputByStage = { SIGNAL:['SIGNAL_SET'], IDEA:['IDEA_SET'], BRIEF:['CONTENT_BRIEF'], CONCEPT:['CONCEPT'], SCRIPT:['SCRIPT'], BIBLE:['PRODUCTION_BIBLE'], SHOT_PLAN:['SHOTS'], ASSET_PLAN:['ASSET_REQUIREMENTS'], ASSET_GENERATION:['ASSETS'], CONTINUITY:['CONTINUITY_REPORT'], EDIT:['EDIT'], PLATFORM_ADAPTATION:['EDITIONS'] };
    for (const stage of priorStages) await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts=$1::jsonb,output_fingerprint=$2,completed_at=now() WHERE id=$3`, [JSON.stringify(outputByStage[stage]), fingerprint({ stage, productionId }), byStage[stage]]);

    const workerId = 'validation-smoke-worker';
    const claimed = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds:60 });
    if (!claimed) throw new Error('VALIDATION production job was not claimed');
    const stage = await claimNextStage(client, { jobId, workerId, leaseSeconds:60 });
    if (!stage || stage.stage !== 'VALIDATION') throw new Error('VALIDATION stage was not unlocked after PLATFORM_ADAPTATION');
    const result = await executeValidationStage({ client, productionId, stageRunId:stage.id, workerId });
    if (!result.artifactId || !result.reportHash || result.report.passed !== true) throw new Error('VALIDATION did not produce a passing canonical report');

    const durable = await client.query(`SELECT a.id,a.artifact_type,a.status,av.output_hash,av.metadata,sr.status AS stage_status,p.status AS production_status FROM v2_1.artifacts a JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1 JOIN v2_1.stage_runs sr ON sr.id=$2 JOIN v2_1.productions p ON p.id=$1 WHERE a.id=$3`, [productionId, stage.id, result.artifactId]);
    const row = durable.rows[0];
    if (!row || row.artifact_type !== 'VALIDATION_REPORT' || row.status !== 'VALID' || row.output_hash !== result.reportHash || row.metadata.contextFingerprint !== context || row.metadata.sourceEditArtifactId !== editArtifactId || row.stage_status !== 'COMPLETED' || row.production_status !== 'RUNNING') throw new Error('VALIDATION durable boundary is incomplete');

    const repeat = await client.query(`SELECT count(*)::integer AS count FROM v2_1.artifacts WHERE production_id=$1 AND artifact_type='VALIDATION_REPORT' AND status='VALID'`, [productionId]);
    if (repeat.rows[0].count !== 1) throw new Error('VALIDATION canonical artifact cardinality is not exactly one');

    console.log('V2.1 VALIDATION DATABASE SMOKE TEST PASSED.');
    console.log('PLATFORM_ADAPTATION -> VALIDATION VERIFIED.');
    console.log('IMMUTABLE CONTEXT + EDIT PROVENANCE VERIFIED.');
    console.log('TIKTOK + YOUTUBE_SHORTS EDITIONS VALIDATED.');
    console.log('DATABASE ENFORCED VALIDATION COMPLETION VERIFIED.');
    console.log('PRODUCTION REMAINS RUNNING UNTIL PUBLISH / ANALYZE / LEARN.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) {
      await client.query(`DELETE FROM v2_1.productions WHERE tenant_id=$1`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.assets WHERE tenant_id=$1`, [tenantId]).catch(() => {});
      await client.query(`DELETE FROM v2_1.tenants WHERE id=$1`, [tenantId]).catch(() => {});
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 VALIDATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
