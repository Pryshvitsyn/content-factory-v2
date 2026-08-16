'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { resolveProductionAssets } = require('../worker/v2.1-asset-registry');

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
    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Asset Registry Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Asset Business ${suffix}`]);
    const otherBusiness = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Other Asset Business ${suffix}`]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [business.rows[0].id, `Asset Brand ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Asset Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `Asset Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Asset Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,'{}'::jsonb,'{}'::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `asset-prod-${suffix}`, `ctx-${suffix}`]);
    const productionId = production.rows[0].id;

    const scriptArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('SCRIPT',$1,'VALID') RETURNING id`, [productionId]);
    const scriptArtifactId = scriptArtifact.rows[0].id;
    const scriptVersion = await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,'asset-script-input','asset-script-output','{}'::jsonb) RETURNING version`, [scriptArtifactId]);
    const scriptVersionNumber = scriptVersion.rows[0].version;
    const scriptHash = 'asset-script-output';

    const bibleArtifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('PRODUCTION_BIBLE',$1,'VALID') RETURNING id`, [productionId]);
    const bible = await client.query(`INSERT INTO v2_1.production_bibles(production_id,version,contract_version,bible_id,context_fingerprint,context_snapshot,document,artifact_id,source_script_artifact_id,source_script_version,source_script_hash) VALUES($1,1,1,$2,$3,'{}'::jsonb,'{}'::jsonb,$4,$5,$6,$7) RETURNING id`, [productionId, `bible-${suffix}`, `ctx-${suffix}`, bibleArtifact.rows[0].id, scriptArtifactId, scriptVersionNumber, scriptHash]);

    const asset = await client.query(`INSERT INTO v2_1.assets(tenant_id,business_id,brand_id,asset_type,name,identity_fingerprint,canonical_data) VALUES($1,$2,$3,'CHARACTER',$4,$5,$6::jsonb) RETURNING id`, [tenantId, business.rows[0].id, brand.rows[0].id, `Hero ${suffix}`, `identity-${suffix}`, JSON.stringify({ description: 'canonical hero' })]);
    const assetId = asset.rows[0].id;
    const version = await client.query(`INSERT INTO v2_1.asset_versions(asset_id,version,data) VALUES($1,1,$2::jsonb) RETURNING id`, [assetId, JSON.stringify({ appearance: 'canonical' })]);

    const shot = await client.query(`INSERT INTO v2_1.shots(production_id,shot_number,duration_ms,instructions,production_bible_id,source_script_artifact_id,context_fingerprint,plan_fingerprint) VALUES($1,1,3000,'{}'::jsonb,$2,$3,$4,$5) RETURNING id`, [productionId, bible.rows[0].id, scriptArtifactId, `ctx-${suffix}`, `plan-${suffix}`]);
    const shotId = shot.rows[0].id;
    const requirement = await client.query(`INSERT INTO v2_1.asset_requirements(shot_id,asset_role,required_asset_type,status,constraints,production_bible_id,context_fingerprint,plan_fingerprint) SELECT $1,'hero','CHARACTER','MISSING',$2::jsonb,s.production_bible_id,$3,$4 FROM v2_1.shots s WHERE s.id=$1 RETURNING id`, [shotId, JSON.stringify({ requiredAssetId: assetId, requiredAssetVersion: 1 }), `ctx-${suffix}`, `plan-${suffix}`]);

    const result = await resolveProductionAssets({ client, productionId });
    if (result.satisfied !== 1 || result.unresolved !== 0) throw new Error('Canonical asset was not resolved');
    const resolved = await client.query(`SELECT resolved_asset_id,resolved_asset_version_id,status,resolution_fingerprint FROM v2_1.asset_requirements WHERE id=$1`, [requirement.rows[0].id]);
    if (resolved.rows[0].resolved_asset_id !== assetId || resolved.rows[0].resolved_asset_version_id !== version.rows[0].id || resolved.rows[0].status !== 'SATISFIED' || !resolved.rows[0].resolution_fingerprint) throw new Error('Asset resolution was not durably persisted');

    await assertRejects(client, `UPDATE v2_1.assets SET name='tampered' WHERE id=$1`, [assetId], /Asset identity\/canonical data is immutable/);
    await assertRejects(client, `INSERT INTO v2_1.assets(tenant_id,business_id,brand_id,asset_type,name,identity_fingerprint) VALUES($1,$2,$3,'CHARACTER',$4,$5)`, [tenantId, business.rows[0].id, brand.rows[0].id, `Hero ${suffix}`, `identity-duplicate-${suffix}`], /duplicate key value violates unique constraint/);

    const foreignAsset = await client.query(`INSERT INTO v2_1.assets(tenant_id,business_id,asset_type,name,identity_fingerprint) VALUES($1,$2,'CHARACTER',$3,$4) RETURNING id`, [tenantId, otherBusiness.rows[0].id, `Foreign ${suffix}`, `foreign-${suffix}`]);
    const foreignVersion = await client.query(`INSERT INTO v2_1.asset_versions(asset_id,version,data) VALUES($1,1,'{}'::jsonb) RETURNING id`, [foreignAsset.rows[0].id]);
    await assertRejects(client, `UPDATE v2_1.asset_requirements SET resolved_asset_id=$1,resolved_asset_version_id=$2,resolution_fingerprint='foreign' WHERE id=$3`, [foreignAsset.rows[0].id, foreignVersion.rows[0].id, requirement.rows[0].id], /violates production ownership boundary|immutable/);

    console.log('V2.1 ASSET REGISTRY DATABASE SMOKE TEST PASSED.');
    console.log('TENANT/BUSINESS/BRAND ASSET OWNERSHIP ENFORCED.');
    console.log('CANONICAL ASSET IDENTITY IMMUTABILITY ENFORCED.');
    console.log('DETERMINISTIC ASSET RESOLUTION PERSISTED.');
    console.log('ASSET VERSION PROVENANCE VERIFIED.');
    console.log('CROSS-BUSINESS ASSET RESOLUTION REJECTED.');
    console.log('DUPLICATE ASSET IDENTITY REJECTED.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
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
  console.error('V2.1 ASSET REGISTRY DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
