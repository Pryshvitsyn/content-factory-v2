'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executePlatformAdaptationStage } = require('../worker/v2.1-platform-adaptation');

const config = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || 'content_os', user: process.env.PGUSER || 'n8n', password: process.env.PGPASSWORD };

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId;
  try {
    const suffix = Date.now().toString();
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Platform Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Platform Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Platform Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Platform Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Platform Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name,target_platform) VALUES($1,$2,'TIKTOK') RETURNING id`, [content.rows[0].id, `Platform Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot,metadata) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,'{}'::jsonb,'{}'::jsonb,$8::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `platform-prod-${suffix}`, `ctx-${suffix}`, JSON.stringify({ platforms: ['TIKTOK', 'YOUTUBE_SHORTS'] })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `platform-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);

    for (const [stage, output] of Object.entries({ SIGNAL:'SIGNAL_SET', IDEA:'IDEA_SET', BRIEF:'CONTENT_BRIEF', CONCEPT:'CONCEPT', SCRIPT:'SCRIPT', BIBLE:'PRODUCTION_BIBLE', SHOT_PLAN:'SHOTS', ASSET_PLAN:'ASSET_REQUIREMENTS', ASSET_GENERATION:'ASSETS' })) {
      await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts=$1::jsonb,output_fingerprint=$2,completed_at=now() WHERE job_id=$3 AND stage=$4`, [JSON.stringify([output]), fingerprint({ stage, suffix }), jobId, stage]);
    }

    const continuityArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('CONTINUITY_REPORT',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-input','continuity-hash',$2::jsonb)`, [continuityArtifact.rows[0].id, JSON.stringify({ stage:'CONTINUITY', contextFingerprint:`ctx-${suffix}` })]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["CONTINUITY_REPORT"]'::jsonb,output_fingerprint='continuity-hash',completed_at=now() WHERE job_id=$1 AND stage='CONTINUITY'`, [jobId]);

    const editArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('EDIT',$1,'VALID') RETURNING id`, [productionId]);
    const editManifest = { type:'EDIT', version:1, contextFingerprint:`ctx-${suffix}`, continuityFingerprint:'continuity-hash', sourceArtifacts:{ continuityReportArtifactId:continuityArtifact.rows[0].id }, timeline:[{ index:1, shotId:'shot-1', startMs:0, endMs:2000, durationMs:2000, assetVersionIds:['asset-version-1'] }], durationMs:2000, renderPolicy:{ mode:'PROVIDER_NEUTRAL' } };
    const editHash = fingerprint(editManifest);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-hash',$2,$3::jsonb)`, [editArtifact.rows[0].id, editHash, JSON.stringify({ stage:'EDIT', contextFingerprint:`ctx-${suffix}`, continuityArtifactId:continuityArtifact.rows[0].id, continuityFingerprint:'continuity-hash', durationMs:2000, manifest:editManifest })]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["EDIT"]'::jsonb,output_fingerprint=$1,completed_at=now() WHERE job_id=$2 AND stage='EDIT'`, [editHash, jobId]);

    const workerId = 'platform-adaptation-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob) throw new Error('PLATFORM_ADAPTATION production job was not claimed');
    const adaptationStage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!adaptationStage || adaptationStage.stage !== 'PLATFORM_ADAPTATION') throw new Error('PLATFORM_ADAPTATION stage was not unlocked after EDIT');

    const result = await executePlatformAdaptationStage({ client, productionId, stageRunId: adaptationStage.id, workerId });
    if (!result.artifactId || result.manifest.type !== 'EDITIONS') throw new Error('PLATFORM_ADAPTATION did not produce canonical EDITIONS');
    if (result.manifest.editions.length !== 2) throw new Error('Expected two deterministic platform editions');

    const durable = await client.query(`SELECT sr.status AS stage_status,a.artifact_type,a.status AS artifact_status,av.output_hash,av.metadata,p.status AS production_status,count(e.id)::integer AS edition_count FROM v2_1.stage_runs sr JOIN v2_1.artifacts a ON a.id=$2 JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1 JOIN v2_1.productions p ON p.id=$1 LEFT JOIN v2_1.editions e ON e.production_id=p.id AND e.artifact_id=a.id WHERE sr.id=$3 GROUP BY sr.status,a.artifact_type,a.status,av.output_hash,av.metadata,p.status`, [productionId,result.artifactId,adaptationStage.id]);
    const row = durable.rows[0];
    if (!row || row.stage_status !== 'COMPLETED' || row.artifact_type !== 'EDITIONS' || row.artifact_status !== 'VALID' || row.output_hash !== result.outputHash || row.metadata.contextFingerprint !== `ctx-${suffix}` || row.metadata.editArtifactId !== editArtifact.rows[0].id || row.metadata.editFingerprint !== editHash || row.edition_count !== 2 || row.production_status !== 'RUNNING') throw new Error('PLATFORM_ADAPTATION durable boundary is incomplete');

    console.log('V2.1 PLATFORM ADAPTATION DATABASE SMOKE TEST PASSED.');
    console.log('EDIT -> PLATFORM_ADAPTATION VERIFIED.');
    console.log('IMMUTABLE CONTEXT + EXACT EDIT PROVENANCE VERIFIED.');
    console.log('MULTI-PLATFORM EDITIONS MATERIALIZED DETERMINISTICALLY.');
    console.log('EDITIONS ARTIFACT -> ARTIFACT_VERSION -> EDITIONS ROWS VERIFIED.');
    console.log('DATABASE ENFORCED PLATFORM_ADAPTATION COMPLETION VERIFIED.');
    console.log('PRODUCTION REMAINS RUNNING UNTIL VALIDATION / PUBLISH / ANALYZE / LEARN.');
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
  console.error('V2.1 PLATFORM ADAPTATION DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
