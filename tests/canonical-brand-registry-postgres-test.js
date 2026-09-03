'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { syncCanonicalBrands, resolveWorkspace } = require('../src/brand-registry/sync-canonical-brands');
const { ensureLegacyBrands } = require('../scripts/prepare-local-live-production');

const W1 = '51000000-0000-4000-8000-000000000001';
const W2 = '51000000-0000-4000-8000-000000000002';
const ATTUNE_ID = '51000000-0000-4000-8000-000000000011';

function databaseName() {
  return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os';
}
function safe() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    throw new Error('Canonical brand registry PostgreSQL tests require a disposable database');
  }
}

const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });

async function createSchema() {
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP TABLE IF EXISTS public.brands CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query('CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL)');
  await db.query('CREATE TABLE public.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name text NOT NULL)');
  await db.query(`CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL, slug text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE',
    mission text, positioning text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(workspace_id,slug)
  )`);
}

async function main() {
  safe();
  try {
    await createSchema();
    await db.query("INSERT INTO workspaces(id,name) VALUES($1,'primary')", [W1]);
    await db.query("INSERT INTO public.brands(id,workspace_id,name) VALUES($1,$2,'Attune')", [ATTUNE_ID, W1]);
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status,mission,positioning,metadata)
      VALUES($1,$2,'Attune','attune','ACTIVE','preserve mission','preserve positioning',$3::jsonb)`,
    [ATTUNE_ID, W1, JSON.stringify({ historical: true })]);

    const first = await syncCanonicalBrands({ db });
    assert.equal(first.workspaceId, W1);
    assert.equal(first.canonicalCount, 8);
    const rows = await db.query('SELECT * FROM v2_2.brands WHERE workspace_id=$1 ORDER BY name', [W1]);
    assert.equal(rows.rows.filter((row) => row.status === 'ACTIVE').length, 8);
    assert.equal(rows.rows.some((row) => row.name === 'Attune' && row.status === 'ACTIVE'), false);

    const tune = rows.rows.find((row) => row.slug === 'tune-into-her');
    assert.ok(tune);
    assert.equal(tune.id, ATTUNE_ID, 'legacy Attune identity is migrated in place so historical productions keep the brand id');
    assert.equal(tune.name, 'Tune Into Her');
    assert.equal(tune.mission, 'preserve mission');
    assert.equal(tune.positioning, 'preserve positioning');
    assert.equal(tune.metadata.historical, true);
    assert.equal(tune.metadata.migratedFromLegacyAlias, 'Attune');
    assert.deepEqual(tune.metadata.aliases, ['Attune']);

    const restartCompatibility = await ensureLegacyBrands(db);
    assert.equal(restartCompatibility.copied, 0,
      'local startup accepts the approved Attune → Tune Into Her canonical rename when id/workspace ownership is unchanged');

    await db.query("UPDATE public.brands SET name='Unapproved Rename' WHERE id=$1", [ATTUNE_ID]);
    await assert.rejects(() => ensureLegacyBrands(db), (error) => error.code === 'LEGACY_BRAND_IDENTITY_CONFLICT');
    await db.query("UPDATE public.brands SET name='Attune' WHERE id=$1", [ATTUNE_ID]);

    const second = await syncCanonicalBrands({ db });
    assert.equal(second.canonicalCount, 8);
    const afterSecond = await db.query('SELECT count(*)::int AS count FROM v2_2.brands WHERE workspace_id=$1', [W1]);
    assert.equal(afterSecond.rows[0].count, 8, 'sync is idempotent');

    await db.query("INSERT INTO workspaces(id,name) VALUES($1,'secondary')", [W2]);
    await assert.rejects(() => resolveWorkspace(db), (error) => error.code === 'CANONICAL_BRAND_WORKSPACE_REQUIRED');
    const explicit = await syncCanonicalBrands({ db, workspaceId: W2 });
    assert.equal(explicit.workspaceId, W2);
    const secondWorkspaceCount = await db.query('SELECT count(*)::int AS count FROM v2_2.brands WHERE workspace_id=$1', [W2]);
    assert.equal(secondWorkspaceCount.rows[0].count, 8);

    console.log('Canonical brand registry PostgreSQL migration, legacy alias restart safety and idempotency: PASS');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP TABLE IF EXISTS public.brands CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE').catch(() => {});
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
