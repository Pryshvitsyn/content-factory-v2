'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');

const V21_MIGRATIONS = [
  'migrations/002_v2_1_execution.sql',
  'migrations/20260819_v2_1_stage_input_propagation.sql',
  'migrations/20260819_v2_1_retry_recovery.sql',
  'migrations/20260820_v2_1_concurrency_certification.sql',
  'migrations/20260820_v2_1_publication_execution.sql',
  'migrations/20260821_v2_1_stage_claim_job_lease_fencing.sql',
  'migrations/20260821_v2_1_asset_registry.sql',
];

const V22_V23_MIGRATIONS = [
  'migrations/20260822_v2_2_growth_foundation.sql',
  'migrations/20260822_v2_2_brand_brain_opportunities.sql',
  'migrations/20260823_v2_3_control_reviews.sql',
];

function hasPlaceholder(url) {
  return !url || /(?:USER|PASSWORD|HOST)/.test(url);
}

function dockerEnv(container) {
  const raw = execFileSync('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container], { encoding: 'utf8' });
  return Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
  }));
}

function dockerPort(container) {
  try {
    const raw = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
    const match = raw.match(/:(\d+)$/m);
    return match ? Number(match[1]) : 5432;
  } catch {
    return 5432;
  }
}

function discoverDatabaseUrl(env = process.env) {
  if (!hasPlaceholder(env.DATABASE_URL)) return { url: env.DATABASE_URL, source: 'DATABASE_URL' };
  const container = env.CONTENT_FACTORY_POSTGRES_CONTAINER || 'n8n-postgres-1';
  let values;
  try {
    values = dockerEnv(container);
  } catch (cause) {
    const error = new Error(`Unable to discover local PostgreSQL from Docker container '${container}'. Start Docker/PostgreSQL or provide a real DATABASE_URL. ${cause.message}`);
    error.code = 'LOCAL_DB_DISCOVERY_FAILED';
    throw error;
  }
  const user = values.POSTGRES_USER || 'postgres';
  const password = values.POSTGRES_PASSWORD || '';
  const database = values.POSTGRES_DB || 'postgres';
  const port = dockerPort(container);
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return { url: `postgresql://${auth}@127.0.0.1:${port}/${encodeURIComponent(database)}`, source: `docker:${container}` };
}

async function tableExists(db, schema, table) {
  const result = await db.query('SELECT to_regclass($1) AS name', [`${schema}.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function requireLegacyBaseline(db) {
  const required = ['workspaces', 'generation_jobs'];
  const missing = [];
  for (const table of required) {
    if (!(await tableExists(db, 'public', table))) missing.push(`public.${table}`);
  }
  if (missing.length) {
    const error = new Error(`Database is not a recognized Content Factory baseline. Missing: ${missing.join(', ')}`);
    error.code = 'CONTENT_FACTORY_BASELINE_REQUIRED';
    throw error;
  }
}

async function applyMigration(db, relative) {
  const sql = await fs.readFile(path.resolve(relative), 'utf8');
  await db.query(sql);
  console.log(`Applied/verified: ${relative}`);
}

async function ensureV21(db) {
  await requireLegacyBaseline(db);
  const existed = await tableExists(db, 'v2_1', 'productions');
  if (!existed) console.log('V2.1 schema not found; bootstrapping canonical V2.1 migrations...');
  else console.log('V2.1 schema found; verifying canonical V2.1 migrations...');

  for (const relative of V21_MIGRATIONS) await applyMigration(db, relative);

  const requiredTables = ['productions', 'jobs', 'stage_runs', 'stage_definitions', 'asset_registry'];
  const missing = [];
  for (const table of requiredTables) {
    if (!(await tableExists(db, 'v2_1', table))) missing.push(`v2_1.${table}`);
  }
  if (missing.length) {
    const error = new Error(`Canonical V2.1 bootstrap incomplete. Missing: ${missing.join(', ')}`);
    error.code = 'V21_BOOTSTRAP_INCOMPLETE';
    throw error;
  }
}

async function ensureLegacyBrands(db) {
  if (!(await tableExists(db, 'public', 'brands'))) return { copied: 0, skipped: 'no legacy public.brands table' };
  const columns = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brands'
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (!names.has('id') || !names.has('name')) return { copied: 0, skipped: 'legacy brands lacks id/name' };

  let workspaceExpression;
  if (names.has('workspace_id')) {
    workspaceExpression = 'b.workspace_id';
  } else {
    const workspaces = await db.query('SELECT id FROM workspaces ORDER BY id');
    if (workspaces.rowCount !== 1) {
      const error = new Error('Legacy brands do not have workspace_id and workspace scope is ambiguous. Exactly one workspace is required for automatic compatibility import.');
      error.code = 'LEGACY_BRAND_SCOPE_AMBIGUOUS';
      throw error;
    }
    workspaceExpression = `'${workspaces.rows[0].id}'::uuid`;
  }

  const result = await db.query(`
    INSERT INTO v2_2.brands(id, workspace_id, name, slug, status, metadata)
    SELECT b.id, ${workspaceExpression}, b.name,
           trim(both '-' from lower(regexp_replace(trim(b.name), '[^a-zA-Z0-9]+', '-', 'g'))),
           'ACTIVE', jsonb_build_object('compatibility_source','public.brands')
    FROM public.brands b
    WHERE NOT EXISTS (SELECT 1 FROM v2_2.brands v WHERE v.id=b.id)
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  return { copied: result.rowCount };
}

async function main() {
  const discovered = discoverDatabaseUrl(process.env);
  const storageRoot = process.env.CONTENT_FACTORY_STORAGE_ROOT || path.join(os.homedir(), '.content-factory', 'storage');
  await fs.mkdir(storageRoot, { recursive: true });

  const db = new Pool({ connectionString: discovered.url, max: 2 });
  try {
    await db.query('SELECT 1');
    await ensureV21(db);

    for (const relative of V22_V23_MIGRATIONS) await applyMigration(db, relative);

    const compatibility = await ensureLegacyBrands(db);
    const brands = await db.query("SELECT id, name, workspace_id FROM v2_2.brands WHERE status='ACTIVE' ORDER BY name");
    const reviewReady = await tableExists(db, 'v2_3', 'master_review_items');

    console.log('\nLOCAL LIVE PRODUCTION ENVIRONMENT READY');
    console.log(`Database source: ${discovered.source}`);
    console.log(`Storage root: ${storageRoot}`);
    console.log(`Legacy brands copied: ${compatibility.copied || 0}`);
    if (compatibility.skipped) console.log(`Legacy brand compatibility: ${compatibility.skipped}`);
    console.log(`V2.1 execution schema: READY`);
    console.log(`V2.2 growth schema: ${(await tableExists(db, 'v2_2', 'brands')) ? 'READY' : 'MISSING'}`);
    console.log(`V2.3 review schema: ${reviewReady ? 'READY' : 'MISSING'}`);
    console.log('Active brands:');
    for (const brand of brands.rows) console.log(`- ${brand.name}: ${brand.id}`);
    console.log('\nLocal runner will reuse this Docker database automatically; no DATABASE_URL editing is required.');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`[${error.code || 'LOCAL_PREPARE_ERROR'}] ${error.message}`);
  process.exitCode = 1;
});

module.exports = {
  V21_MIGRATIONS,
  V22_V23_MIGRATIONS,
  discoverDatabaseUrl,
  hasPlaceholder,
};
