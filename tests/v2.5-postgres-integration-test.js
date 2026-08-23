'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { PostgresMediaExecutionRepository } = require('../src/v2.5/durable-media-executor');

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_WORKSPACE_ID = '10000000-0000-4000-8000-000000000099';
const BRAND_ID = '20000000-0000-4000-8000-000000000002';
const OTHER_BRAND_ID = '20000000-0000-4000-8000-000000000099';
const PRODUCTION_ID = '30000000-0000-4000-8000-000000000003';

function databaseName() {
  if (process.env.DATABASE_URL) return new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  return process.env.PGDATABASE || 'content_os';
}

function assertDisposableDatabase() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    const error = new Error('V2.5 PostgreSQL integration requires CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database.');
    error.code = 'TEST_DATABASE_NOT_EXPLICIT';
    throw error;
  }
}

const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });

function videoAsset(id = 'video-1') {
  return { asset_id: id, kind: 'video', generation_requirements: { provider: 'replicate', model: 'wan-test' } };
}

async function bootstrapCertifiedBoundary() {
  await db.query('DROP SCHEMA IF EXISTS v2_5 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query(`CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL)`);
  await db.query(`CREATE SCHEMA v2_2`);
  await db.query(`CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id),name text,status text NOT NULL)`);
  await db.query(`CREATE SCHEMA v2_1`);
  await db.query(`CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    brand_id uuid NOT NULL REFERENCES v2_2.brands(id),name text NOT NULL,status text NOT NULL DEFAULT 'DRAFT',objective text,metadata jsonb NOT NULL DEFAULT '{}',
    started_at timestamptz,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,name))`);
  await db.query(`CREATE TABLE v2_1.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_id uuid NOT NULL REFERENCES v2_1.productions(id),
    stage text NOT NULL,status text NOT NULL DEFAULT 'QUEUED',idempotency_key text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',result jsonb NOT NULL DEFAULT '{}',
    worker_id text,started_at timestamptz,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(production_id,idempotency_key))`);
  await db.query(`INSERT INTO public.workspaces(id,name) VALUES($1,'Primary'),($2,'Other')`, [WORKSPACE_ID, OTHER_WORKSPACE_ID]);
  await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,status) VALUES($1,$2,'Attune','ACTIVE'),($3,$4,'Other','ACTIVE')`,
    [BRAND_ID, WORKSPACE_ID, OTHER_BRAND_ID, OTHER_WORKSPACE_ID]);
  await db.query(`INSERT INTO v2_1.productions(id,workspace_id,brand_id,name,status,objective) VALUES($1,$2,$3,'v2.5-real:test','DRAFT','ENGAGEMENT')`,
    [PRODUCTION_ID, WORKSPACE_ID, BRAND_ID]);
}

async function main() {
  assertDisposableDatabase();
  try {
    await bootstrapCertifiedBoundary();
    const migration = await fs.readFile(path.resolve('migrations/20260823_v2_5_durable_media_executions.sql'), 'utf8');
    await db.query(migration);
    await db.query(migration); // ordered migration must remain repeatable for local preparation
    const repository = new PostgresMediaExecutionRepository({ db });
    assert.deepEqual(await repository.inspectSchema(), { ready: true });

    const probe = await repository.verifyTransactionalPlan({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      objective: 'ENGAGEMENT', inputFingerprint: 'input-fingerprint', assets: [videoAsset(), { ...videoAsset('voice-1'), kind: 'voice' }] });
    assert.deepEqual(probe, { passed: true, persisted: false, mediaClaims: 2, providerCalls: 0 });
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.productions WHERE name LIKE 'v2.5-preflight:%'`)).rows[0].count, 0);

    const args = { workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID,
      asset: videoAsset(), fingerprint: 'asset-fingerprint', idempotencyKey: 'asset-idempotency', provider: 'replicate', model: 'wan-test' };
    const rows = await Promise.all(Array.from({ length: 8 }, () => repository.ensure(args)));
    assert.equal(new Set(rows.map((row) => row.id)).size, 1, 'concurrent planning must converge on one durable asset row');
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => repository.claim({ id: rows[0].id, workerId: `worker-${index}` })));
    const winner = claims.find(Boolean);
    assert.equal(claims.filter(Boolean).length, 1, 'only one worker may cross the per-asset claim');
    await repository.markBoundary({ id: winner.id, workerId: winner.worker_id });
    await repository.recordProviderRequest({ id: winner.id, workerId: winner.worker_id, requestId: 'prediction-durable', providerStatus: 'processing' });
    const adopted = await repository.adopt({ id: winner.id, workerId: winner.worker_id,
      artifact: { artifactId: 'brand:asset:video-1', version: 1, storageKey: 'artifacts/video-1.bin', contentHash: 'hash-1' },
      media: { contentType: 'video/mp4', requestId: 'prediction-durable', provenance: { provider: 'replicate' } },
      probe: { durationMs: 3000, size: 1000, videoCodec: 'h264', hasAudio: false } });
    assert.equal(adopted.status, 'SUCCEEDED'); assert.equal(adopted.provider_request_id, 'prediction-durable');
    assert.equal((await repository.list(PRODUCTION_ID)).length, 1);

    await assert.rejects(() => repository.ensure({ ...args, fingerprint: 'different-fingerprint' }),
      (error) => error.code === 'MEDIA_EXECUTION_CONFLICT');
    await assert.rejects(() => repository.ensure({ ...args, asset: videoAsset('cross-brand'), brandId: OTHER_BRAND_ID }),
      /ownership does not match production ownership/);
    console.log('V2.5 PostgreSQL clean/repeatable migration, ownership, concurrency, and provider-boundary integration passed.');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_5 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE').catch(() => {});
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
