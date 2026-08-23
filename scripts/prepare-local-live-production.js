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

const LEGACY_INDICATORS = ['brands', 'app_registry', 'content_items', 'content_outputs', 'approvals'];

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
  const database = env.CONTENT_FACTORY_DATABASE || 'content_os';
  const port = dockerPort(container);
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return { url: `postgresql://${auth}@127.0.0.1:${port}/${encodeURIComponent(database)}`, source: `docker:${container}` };
}

async function tableExists(db, schema, table) {
  const result = await db.query('SELECT to_regclass($1) AS name', [`${schema}.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function applyMigration(db, relative) {
  console.log(`Applying/verifying: ${relative}`);
  const sql = await fs.readFile(path.resolve(relative), 'utf8');
  try {
    await db.query(sql);
  } catch (error) {
    error.message = `${relative}: ${error.message}`;
    throw error;
  }
  console.log(`Applied/verified: ${relative}`);
}

async function ensureCompatibilityFoundation(db) {
  const hasWorkspaces = await tableExists(db, 'public', 'workspaces');
  const hasGenerationJobs = await tableExists(db, 'public', 'generation_jobs');
  if (hasWorkspaces && hasGenerationJobs) return { created: false, workspaceCreated: false, generationJobsCreated: false };

  const indicators = [];
  for (const table of LEGACY_INDICATORS) {
    if (await tableExists(db, 'public', table)) indicators.push(table);
  }
  if (!indicators.length) {
    const error = new Error('Database is neither a current Content Factory schema nor a recognized legacy Content OS database. Refusing automatic bootstrap.');
    error.code = 'CONTENT_FACTORY_BASELINE_REQUIRED';
    throw error;
  }

  console.log(`Legacy Content OS baseline detected (${indicators.join(', ')}). Creating minimal V2 compatibility foundation...`);
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  let workspaceCreated = false;
  let generationJobsCreated = false;

  if (!hasWorkspaces) {
    await db.query(`
      CREATE TABLE public.workspaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.query(`
      INSERT INTO public.workspaces(name, slug, metadata)
      VALUES('Local Content Factory', 'local-content-factory', '{"compatibility_source":"legacy-content-os"}'::jsonb)
      ON CONFLICT(slug) DO NOTHING
    `);
    workspaceCreated = true;
  } else {
    const count = await db.query('SELECT count(*)::int AS count FROM public.workspaces');
    if (count.rows[0].count === 0) {
      const columns = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces'`);
      const names = new Set(columns.rows.map((row) => row.column_name));
      if (names.has('name') && names.has('slug')) {
        await db.query(`INSERT INTO public.workspaces(name, slug) VALUES('Local Content Factory', 'local-content-factory') ON CONFLICT DO NOTHING`);
      } else {
        const error = new Error('Existing public.workspaces is empty and cannot be populated safely by the compatibility bootstrap.');
        error.code = 'WORKSPACE_BOOTSTRAP_AMBIGUOUS';
        throw error;
      }
    }
  }

  if (!hasGenerationJobs) {
    await db.query(`
      CREATE TABLE public.generation_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    generationJobsCreated = true;
  }

  return { created: true, workspaceCreated, generationJobsCreated };
}

async function normalizeLegacyV21(db) {
  const exists = await tableExists(db, 'v2_1', 'productions');
  if (!exists) return;

  console.log('Normalizing legacy V2.1 table shape (additive only)...');

  await db.query(`
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS status text DEFAULT 'DRAFT';
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
  `);

  if (await tableExists(db, 'v2_1', 'jobs')) {
    await db.query(`
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS production_id uuid REFERENCES v2_1.productions(id) ON DELETE CASCADE;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS generation_job_id uuid REFERENCES public.generation_jobs(id) ON DELETE SET NULL;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS stage text;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS status text DEFAULT 'QUEUED';
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS worker_id text;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
      ALTER TABLE v2_1.jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    `);
  }

  if (await tableExists(db, 'v2_1', 'stage_runs')) {
    await db.query(`
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES v2_1.jobs(id) ON DELETE CASCADE;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS stage text;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDING';
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS worker_id text;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS input_artifacts jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS output_artifacts jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS input_fingerprint text;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS output_fingerprint text;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
      ALTER TABLE v2_1.stage_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    `);
  }

  if (await tableExists(db, 'v2_1', 'stage_definitions')) {
    await db.query(`
      ALTER TABLE v2_1.stage_definitions ADD COLUMN IF NOT EXISTS sequence_no integer;
      ALTER TABLE v2_1.stage_definitions ADD COLUMN IF NOT EXISTS terminal boolean DEFAULT false;
      ALTER TABLE v2_1.stage_definitions ADD COLUMN IF NOT EXISTS retryable boolean DEFAULT true;
    `);
  }

  if (await tableExists(db, 'v2_1', 'concurrency_certifications')) {
    await db.query(`ALTER TABLE v2_1.concurrency_certifications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()`);
  }

  if (await tableExists(db, 'v2_1', 'asset_registry')) {
    await db.query(`
      ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
      ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
      ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
    `);
  }
}

async function ensureV21(db) {
  const compatibility = await ensureCompatibilityFoundation(db);
  const existed = await tableExists(db, 'v2_1', 'productions');
  if (!existed) console.log('V2.1 schema not found; bootstrapping canonical V2.1 migrations...');
  else console.log('V2.1 schema found; verifying canonical V2.1 migrations...');

  await normalizeLegacyV21(db);
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
  return compatibility;
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
    const workspaces = await db.query('SELECT id FROM public.workspaces ORDER BY id');
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
           COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(trim(b.name), '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'brand-' || left(b.id::text, 8)),
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
    const compatibilityFoundation = await ensureV21(db);

    for (const relative of V22_V23_MIGRATIONS) await applyMigration(db, relative);

    const compatibility = await ensureLegacyBrands(db);
    const brands = await db.query("SELECT id, name, workspace_id FROM v2_2.brands WHERE status='ACTIVE' ORDER BY name");
    const reviewReady = await tableExists(db, 'v2_3', 'master_review_items');

    console.log('\nLOCAL LIVE PRODUCTION ENVIRONMENT READY');
    console.log(`Database source: ${discovered.source}`);
    console.log(`Storage root: ${storageRoot}`);
    console.log(`Compatibility foundation created: ${compatibilityFoundation.created ? 'YES' : 'NO'}`);
    console.log(`Legacy brands copied: ${compatibility.copied || 0}`);
    if (compatibility.skipped) console.log(`Legacy brand compatibility: ${compatibility.skipped}`);
    console.log('V2.1 execution schema: READY');
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
  LEGACY_INDICATORS,
  discoverDatabaseUrl,
  ensureCompatibilityFoundation,
  normalizeLegacyV21,
  hasPlaceholder,
};
