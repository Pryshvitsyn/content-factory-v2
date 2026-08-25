'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { ProviderCatalog, PostgresProviderCatalogRepository } = require('../src/v2.8/provider-catalog');

const W1 = '10000000-0000-4000-8000-000000000001';
const W2 = '10000000-0000-4000-8000-000000000002';

function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os'; }
function safe() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    const error = new Error('V2.8 PostgreSQL tests require CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database');
    error.code = 'TEST_DATABASE_NOT_EXPLICIT'; throw error;
  }
}

const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });
async function migration(name) { await db.query(await fs.readFile(path.resolve('migrations', name), 'utf8')); }

async function bootstrapLatest() {
  await db.query('DROP SCHEMA IF EXISTS v2_8 CASCADE'); await db.query('DROP SCHEMA IF EXISTS v2_5 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE'); await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE'); await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query('CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL)');
  await db.query('CREATE TABLE public.generation_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
  await migration('002_v2_1_execution.sql'); await migration('20260822_v2_2_growth_foundation.sql');
  await migration('20260823_v2_5_durable_media_executions.sql');
  await db.query("INSERT INTO workspaces(id,name) VALUES($1,'one'),($2,'two')", [W1,W2]);
}

async function main() {
  safe();
  try {
    await bootstrapLatest();
    await migration('20260825_v2_8_universal_provider_catalog.sql');
    await migration('20260825_v2_8_universal_provider_catalog.sql');
    const columns = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='v2_5'
      AND table_name='media_executions' AND column_name IN ('vendor','model_version','profile','capability','resolved_settings')`);
    assert.equal(columns.rowCount, 5, 'upgrade adds provenance columns without replacing V2.5 rows');
    const repository = new PostgresProviderCatalogRepository({ db });
    const first = new ProviderCatalog({ env: { FAL_KEY: 'synthetic' }, repository, workspaceId: W1 });
    await first.addModel({ workspaceId: W1, provider: 'fal', modelId: 'acme/new-video', displayName: 'New Video', preset: 'VIDEO_STANDARD' });
    const duplicate = await first.addModel({ workspaceId: W1, provider: 'fal', modelId: 'acme/new-video', displayName: 'New Video v2', preset: 'VIDEO_STANDARD' });
    assert.equal(duplicate.modelId, 'acme/new-video');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM v2_8.provider_models WHERE workspace_id=$1", [W1])).rows[0].count, 1);
    const second = new ProviderCatalog({ env: { FAL_KEY: 'synthetic' }, repository, workspaceId: W2 }); await second.refresh();
    assert.equal(second.listModels('fal').some((model) => model.modelId === 'acme/new-video'), false, 'workspace model registration does not leak');
    await assert.rejects(() => db.query("UPDATE v2_8.provider_models SET model_id='changed/model' WHERE workspace_id=$1", [W1]), /immutable/);
    console.log('V2.8 additive PostgreSQL catalog migration, idempotence, persistence, immutability, and workspace isolation passed.');
  } finally { await db.query('DROP SCHEMA IF EXISTS v2_8 CASCADE').catch(() => {}); await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
