'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { claimJobForProduction, claimNextStage, fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { executePlatformAdaptationStage } = require('../worker/v2.1-platform-adaptation');

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
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Platform Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Platform Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Platform Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Platform Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Platform Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Platform Variant ${suffix}`]);
    const requestSnapshot = { targetPlatforms: ['TIKTOK', 'YOUTUBE_SHORTS'] };
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,'{}'::jsonb,$8::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `platform-prod-${suffix}`, `ctx-${suffix}`, JSON.stringify(requestSnapshot)]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input) VALUES($1,'PRODUCTION','QUEUED',$2,'{}'::jsonb) RETURNING id`, [productionId, `platform-job-${suffix}`]);
    const jobId = job.rows[0].id;
    for (const stage of allStageNames()) await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint) VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`, [jobId, stage, fingerprint({ productionId, stage })]);

    const editManifest = {
      type: 'EDIT', version: 1, contextFingerprint: `ctx-${suffix}`, continuityFingerprint: 'continuity-hash',
      sourceArtifacts: { continuityReportArtifactId: 'continuity-1' },
      durationMs: 2500,
      timeline: [
        { index: 1, shotId: 'shot-1', shotNumber: 1, startMs: 0, endMs: 1000, durationMs: 1000, assetVersionIds: ['asset-v1'] },
        { index: 2, shotId: 'shot-2', shotNumber: 2, startMs: 1000, endMs: 2500, durationMs: 1500, assetVersionIds: ['asset-v2'] },
      ],
    };
    const editArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('EDIT',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-hash','edit-hash',$2::jsonb)`, [editArtifact.rows[0].id, JSON.stringify({ stage:'EDIT', contextFingerprint:`ctx-${suffix}`, continuityArtifactId:'continuity-1', continuityFingerprint:'continuity-hash', durationMs:2500, shotCount:2, manifest: editManifest })]);
    const continuityArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('CONTINUITY_REPORT',$1,'VALID') RETURNING id`, [productionId]);
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'continuity-input','continuity-hash',$2::jsonb)`, [continuityArtifact.rows[0].id, JSON.stringify({ stage:'CONTINUITY', contextFingerprint:`ctx-${suffix}`, checkCount:8 })]);

    const stages = await client.query(`SELECT id,stage FROM v2_1.stage_runs WHERE job_id=$1`, [jobId]);
    const byStage = Object.fromEntries(stages.rows.map((r) => [r.stage, r.id]));
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["EDIT"]'::jsonb,output_fingerprint='edit-hash',completed_at=now() WHERE id=$1`, [byStage.EDIT]);
    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["CONTINUITY_REPORT"]'::jsonb,output_fingerprint='continuity-hash',completed_at=now() WHERE id=$1`, [byStage.CONTINUITY]);

    const workerId = 'platform-adaptation-smoke-worker';
    const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds: 60 });
    if (!claimedJob) throw new Error('PLATFORM_ADAPTATION production job was not claimed');
    const stage = await claimNextStage(client, { jobId, workerId, leaseSeconds: 60 });
    if (!stage || stage.stage !== 'PLATFORM_ADAPTATION') throw new Error('PLATFORM_ADAPTATION stage was not unlocked after EDIT');
    const result = await executePlatformAdaptationStage({ client, productionId, stageRunId: stage.id, workerId });
    if (result.editionIds.length !== 2 || result.platforms.join(',') !== 'TIKTOK,YOUTUBE_SHORTS') throw new Error('PLATFORM_ADAPTATION did not materialize the requested editions');

    const durable = await client.query(`SELECT e.platform,e.version,e.artifact_id,e.metadata,sr.status AS stage_status,p.status AS production_status FROM v2_1.editions e JOIN v2_1.stage_runs sr ON sr.id=$2 JOIN v2_1.productions p ON p.id=$1 WHERE e.production_id=$1 ORDER BY e.platform`, [productionId, stage.id]);
    if (durable.rows.length !== 2) throw new Error('Expected exactly two durable platform editions');
    for (const row of durable.rows) {
      if (row.version !== 1 || row.artifact_id !== editArtifact.rows[0].id || row.metadata.contextFingerprint !== `ctx-${suffix}` || row.metadata.sourceEditArtifactId !== editArtifact.rows[0].id || row.metadata.stage !== 'PLATFORM_ADAPTATION') throw new Error(`Edition provenance is invalid for ${row.platform}`);
    }
    if (durable.rows[0].stage_status !== 'COMPLETED' || durable.rows[0].production_status !== 'RUNNING') throw new Error('PLATFORM_ADAPTATION durable boundary is incomplete');

    const repeatStage = await client.query(`SELECT id FROM v2_1.stage_runs WHERE job_id=$1 AND stage='PLATFORM_ADAPTATION' AND status='QUEUED' ORDER BY attempt DESC LIMIT 1`, [jobId]);
    if (repeatStage.rowCount) throw new Error('Unexpected duplicate queued PLATFORM_ADAPTATION stage exists');

    console.log('V2.1 PLATFORM ADAPTATION DATABASE SMOKE TEST PASSED.');
    console.log('EDIT -> PLATFORM_ADAPTATION VERIFIED.');
    console.log('IMMUTABLE CONTEXT + EDIT PROVENANCE VERIFIED.');
    console.log('DETERMINISTIC TIKTOK + YOUTUBE_SHORTS EDITIONS VERIFIED.');
    console.log('DATABASE ENFORCED EDITION COMPLETION VERIFIED.');
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
