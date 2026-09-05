'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { discoverLocalDatabase, hasPlaceholder, localStorageRoot } = require('./local-runtime');
const {
  assertSchemaCompatible,
  formatCompatibilityReport,
  inspectSchemaCompatibility,
} = require('../src/v2.4/schema-compatibility');

const COMPATIBILITY_MIGRATION = 'migrations/20260823_v2_4_legacy_schema_compatibility.sql';
const V21_MIGRATIONS = [
  'migrations/002_v2_1_execution.sql',
  'migrations/20260819_v2_1_stage_input_propagation.sql',
  'migrations/20260819_v2_1_retry_recovery.sql',
  'migrations/20260820_v2_1_concurrency_certification.sql',
  'migrations/20260820_v2_1_publication_execution.sql',
  'migrations/20260821_v2_1_stage_claim_job_lease_fencing.sql',
  'migrations/20260821_v2_1_asset_registry.sql',
];
const V22_MIGRATIONS = [
  'migrations/20260822_v2_2_growth_foundation.sql',
  'migrations/20260822_v2_2_brand_brain_opportunities.sql',
];
const V23_MIGRATIONS = ['migrations/20260823_v2_3_control_reviews.sql'];
const V24_OWNERSHIP_MIGRATIONS = ['migrations/20260823_v2_4_canonical_production_ownership.sql'];
const V25_MIGRATIONS = ['migrations/20260823_v2_5_durable_media_executions.sql'];
const V26_MIGRATIONS = ['migrations/20260824_v2_6_fast_render_executions.sql'];
const V27_MIGRATIONS = ['migrations/20260824_v2_7_1_shot_regenerations.sql'];
const V292_MIGRATIONS = [
  'migrations/20260828_v2_9_2_semantic_evaluation_attempts.sql',
  'migrations/20260828_v2_9_2_1_semantic_retry_partial_media.sql',
  'migrations/20260828_v2_9_2_2_semantic_recovery_resume.sql',
  'migrations/20260828_v2_9_2_3_legacy_plan_only_recovery.sql',
];
const V210_MIGRATIONS = [
  'migrations/20260829_v2_10_creative_production.sql',
  'migrations/20260829_v2_10_completion.sql',
  'migrations/20260830_v2_10_2_reference_geometry_recovery.sql',
  'migrations/20260831_v2_10_4_source_creative_recovery.sql',
  'migrations/20260901_locked_keyframe_production.sql',
  'migrations/20260903_quality_script_first.sql',
  'migrations/20260903_locked_stage_retry_history.sql',
  'migrations/20260903_avatar_studio_source_viewpoint_classification.sql',
  'migrations/20260904_avatar_motion_pilot.sql',
  'migrations/20260905_avatar_motion_pilot_raw_provider_output.sql',
  'migrations/20260905_production_continuity_authority.sql',
  'migrations/20260906_avatar_motion_pilot_identity_reviews.sql',
  'migrations/20260907_avatar_motion_pilot_identity_review_immutable.sql',
  'migrations/20260908_avatar_motion_pilot_reference_to_video.sql',
  'migrations/20260909_avatar_studio_identity_intake_v1.sql',
  'migrations/20260910_avatar_motion_pilot_route_variants.sql',
  'migrations/20260911_avatar_motion_pilot_automatic_qa.sql',
  'migrations/20260912_avatar_motion_quality_batch_preflight.sql',
  'migrations/20260913_avatar_provider_reference_canonical.sql',
];

function discoverDatabaseUrl(env = process.env) {
  const discovered = discoverLocalDatabase(env);
  return { url: discovered.url, source: discovered.source };
}

async function tableExists(db, schema, table) {
  const result = await db.query('SELECT to_regclass($1) AS name', [`${schema}.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function applyMigration(db, relative) {
  console.log(`Applying/verifying: ${relative}`);
  try { await db.query(await fs.readFile(path.resolve(relative), 'utf8')); }
  catch (error) { error.message = `${relative}: ${error.message}`; throw error; }
}

async function assertCompatibilityFoundation(db) {
  const required = [['public', 'workspaces'], ['public', 'generation_jobs']];
  const missing = [];
  for (const [schema, table] of required) if (!(await tableExists(db, schema, table))) missing.push(`${schema}.${table}`);
  if (missing.length) {
    const error = new Error(`Required persisted foundation is missing: ${missing.join(', ')}. Refusing to invent workspace/content ownership.`);
    error.code = 'CONTENT_FACTORY_BASELINE_REQUIRED';
    throw error;
  }
}

async function ensureV21(db) {
  await assertCompatibilityFoundation(db);
  const legacyV21 = await tableExists(db, 'v2_1', 'productions');
  if (legacyV21) await applyMigration(db, COMPATIBILITY_MIGRATION);
  for (const relative of V21_MIGRATIONS) await applyMigration(db, relative);
  await applyMigration(db, COMPATIBILITY_MIGRATION);
}

function approvedLegacyCanonicalRename(row) {
  if (!row || String(row.legacy_workspace_id) !== String(row.canonical_workspace_id)) return false;
  const legacyName = String(row.legacy_name || '').trim().toLowerCase();
  const canonicalName = String(row.canonical_name || '').trim().toLowerCase();
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.map((value) => String(value).trim().toLowerCase()) : [];
  return legacyName === 'attune'
    && canonicalName === 'tune into her'
    && String(metadata.canonicalContext || '').trim().toLowerCase() === 'tune into her'
    && aliases.includes('attune');
}

async function ensureLegacyBrands(db) {
  if (!(await tableExists(db, 'public', 'brands'))) return { copied: 0, skipped: 'no public.brands table' };
  const columns = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='brands'`);
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (!['id', 'workspace_id', 'name'].every((name) => names.has(name))) {
    const error = new Error('public.brands must contain persisted id, workspace_id and name; automatic ownership inference is forbidden');
    error.code = 'LEGACY_BRAND_SCOPE_AMBIGUOUS';
    throw error;
  }
  const orphan = await db.query(`SELECT b.id FROM public.brands b LEFT JOIN public.workspaces w ON w.id=b.workspace_id WHERE w.id IS NULL LIMIT 1`);
  if (orphan.rows[0]) {
    const error = new Error(`Legacy brand ${orphan.rows[0].id} has no persisted workspace owner`);
    error.code = 'LEGACY_BRAND_SCOPE_INVALID';
    throw error;
  }
  const conflicts = await db.query(`
    SELECT b.id,b.workspace_id AS legacy_workspace_id,b.name AS legacy_name,
      v.workspace_id AS canonical_workspace_id,v.name AS canonical_name,v.metadata
    FROM public.brands b JOIN v2_2.brands v ON v.id=b.id
    WHERE v.workspace_id IS DISTINCT FROM b.workspace_id OR v.name IS DISTINCT FROM b.name`);
  const conflict = conflicts.rows.find((row) => !approvedLegacyCanonicalRename(row));
  if (conflict) {
    const error = new Error(`Canonical brand ${conflict.id} conflicts with persisted public.brands ownership`);
    error.code = 'LEGACY_BRAND_IDENTITY_CONFLICT';
    throw error;
  }
  const result = await db.query(`
    INSERT INTO v2_2.brands(id,workspace_id,name,slug,status,metadata)
    SELECT b.id,b.workspace_id,b.name,
      left(COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(trim(b.name),'[^a-zA-Z0-9]+','-','g'))),''),'brand'),40)
        || '-' || left(b.id::text,8),
      'ACTIVE',jsonb_build_object('compatibility_source','public.brands','identity_preserved',true)
    FROM public.brands b
    WHERE NOT EXISTS (SELECT 1 FROM v2_2.brands v WHERE v.id=b.id)
    ON CONFLICT DO NOTHING RETURNING id`);
  const unresolved = await db.query(`SELECT b.id FROM public.brands b LEFT JOIN v2_2.brands v ON v.id=b.id WHERE v.id IS NULL LIMIT 1`);
  if (unresolved.rows[0]) {
    const error = new Error(`Legacy brand ${unresolved.rows[0].id} could not be represented canonically without conflict`);
    error.code = 'LEGACY_BRAND_IMPORT_CONFLICT';
    throw error;
  }
  return { copied: result.rowCount };
}

async function prepareDatabase(db) {
  await db.query('SELECT 1');
  await assertCompatibilityFoundation(db);
  const initialReport = await inspectSchemaCompatibility(db);
  if (initialReport.compatible) {
    const brands = await ensureLegacyBrands(db);
    for (const relative of V24_OWNERSHIP_MIGRATIONS) await applyMigration(db, relative);
    for (const relative of V25_MIGRATIONS) await applyMigration(db, relative);
    for (const relative of V26_MIGRATIONS) await applyMigration(db, relative);
    for (const relative of V27_MIGRATIONS) await applyMigration(db, relative);
    for (const relative of V292_MIGRATIONS) await applyMigration(db, relative);
    for (const relative of V210_MIGRATIONS) await applyMigration(db, relative);
    return { report: await inspectSchemaCompatibility(db), brands, alreadyCompatible: true };
  }
  await ensureV21(db);
  for (const relative of V22_MIGRATIONS) await applyMigration(db, relative);
  const brands = await ensureLegacyBrands(db);
  await applyMigration(db, COMPATIBILITY_MIGRATION);
  for (const relative of V24_OWNERSHIP_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V23_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V25_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V26_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V27_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V292_MIGRATIONS) await applyMigration(db, relative);
  for (const relative of V210_MIGRATIONS) await applyMigration(db, relative);
  const report = await inspectSchemaCompatibility(db);
  assertSchemaCompatible(report);
  return { report, brands, alreadyCompatible: false };
}

async function main() {
  const discovered = discoverDatabaseUrl(process.env);
  const storageRoot = localStorageRoot(process.env);
  await fs.mkdir(storageRoot, { recursive: true });
  const db = new Pool({ connectionString: discovered.url, max: 2 });
  try {
    const result = await prepareDatabase(db);
    const brands = await db.query("SELECT id,name,workspace_id FROM v2_2.brands WHERE status='ACTIVE' ORDER BY name");
    console.log('\nLOCAL LIVE PRODUCTION ENVIRONMENT READY');
    console.log(`Database source: ${discovered.source}`);
    console.log(`Storage root: ${storageRoot}`);
    console.log(`Schema migration required: ${result.alreadyCompatible ? 'NO' : 'YES'}`);
    console.log(`Legacy brands copied with exact identity: ${result.brands.copied || 0}`);
    console.log(formatCompatibilityReport(result.report));
    console.log('Active brands:');
    for (const brand of brands.rows) console.log(`- ${brand.name}: ${brand.id}`);
  } finally { await db.end(); }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${error.code || 'LOCAL_PREPARE_ERROR'}] ${error.message}`);
    if (error.details) console.error(formatCompatibilityReport(error.details));
    process.exitCode = 1;
  });
}

module.exports = {
  COMPATIBILITY_MIGRATION,
  V21_MIGRATIONS,
  V22_MIGRATIONS,
  V23_MIGRATIONS,
  V24_OWNERSHIP_MIGRATIONS,
  V25_MIGRATIONS,
  V26_MIGRATIONS,
  V27_MIGRATIONS,
  V292_MIGRATIONS,
  V210_MIGRATIONS,
  applyMigration,
  approvedLegacyCanonicalRename,
  assertCompatibilityFoundation,
  discoverDatabaseUrl,
  ensureLegacyBrands,
  ensureV21,
  hasPlaceholder,
  prepareDatabase,
  tableExists,
};
