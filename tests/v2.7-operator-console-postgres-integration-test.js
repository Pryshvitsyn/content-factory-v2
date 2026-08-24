'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ControlReviewService } = require('../src/v2.3/control-review-service');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { ProductionCommandService, operatorInputFromRaw } = require('../src/v2.7/production-command-service');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { ControlRepository } = require('../apps/dashboard/server/control-repository');

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const BRAND_ID = '20000000-0000-4000-8000-000000000002';
const REQUEST_ID = '30000000-0000-4000-8000-000000000003';

function databaseName() {
  if (process.env.DATABASE_URL) return new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  return process.env.PGDATABASE || 'content_os';
}

function assertDisposableDatabase() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    const error = new Error('V2.7 PostgreSQL certification requires CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database.');
    error.code = 'TEST_DATABASE_NOT_EXPLICIT'; throw error;
  }
}

const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });

async function migration(name) { await db.query(await fs.readFile(path.resolve('migrations', name), 'utf8')); }

async function bootstrap() {
  await db.query('DROP SCHEMA IF EXISTS v2_6 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_5 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_3 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE');
  await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query('CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL)');
  await db.query('CREATE TABLE public.generation_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
  await migration('002_v2_1_execution.sql');
  await migration('20260822_v2_2_growth_foundation.sql');
  await migration('20260822_v2_2_brand_brain_opportunities.sql');
  await migration('20260821_v2_1_asset_registry.sql');
  await migration('20260823_v2_3_control_reviews.sql');
  await migration('20260823_v2_4_canonical_production_ownership.sql');
  await migration('20260823_v2_5_durable_media_executions.sql');
  await migration('20260824_v2_6_fast_render_executions.sql');
  await db.query("INSERT INTO public.workspaces(id,name) VALUES($1,'V2.7 disposable workspace')", [WORKSPACE_ID]);
  await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status,mission,positioning)
    VALUES($1,$2,'Attune','attune','ACTIVE','Help people understand each other','Emotionally intelligent attention')`,
  [BRAND_ID, WORKSPACE_ID]);
}

function request(requestId = REQUEST_ID) {
  return { requestId, brandId: BRAND_ID, renderMode: 'FAST', title: 'Attune fixture production',
    objective: 'ENGAGEMENT', platform: 'Instagram Reels', targetDurationSeconds: 10, aspectRatio: '9:16',
    hook: 'Silence can feel like distance.', coreMessage: 'Attention creates understanding.',
    creativeBrief: 'A quiet human moment moves from assumption to attention.', cta: "Don't guess. Tune in.",
    captionsEnabled: true, musicEnabled: false };
}

async function main() {
  assertDisposableDatabase();
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v27-'));
  let externalProviderCalls = 0;
  try {
    await bootstrap();
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifactService = new ArtifactService({ storage });
    const reviews = new ControlReviewService({ db });
    const repository = new ControlRepository({ db });
    const quality = Object.freeze({ status: 'PASS', score: 1, readyForHumanReview: true,
      publicationAllowed: false, checks: [{ code: 'fixture-validation', status: 'PASS' }] });
    const rendererRouter = {
      async preflight() { return { probe: { passed: true, persisted: false }, executions: [],
        availability: { configured: true, availability: 'AVAILABLE' } }; },
      plan({ input, laneState }) { return { renderMode: 'FAST', renderer: 'moneyprinterturbo', rendererVersion: 'fixture',
        provider: null, model: null, resolution: '1080x1920', aspectRatio: input.aspectRatio,
        expectedVideoGenerations: 0, expectedAudioGenerations: 0, expectedPaidProviderCalls: 0,
        expectedRendererJobs: 1, expectedExternalServiceCalls: 1, providerExecutions: 0,
        dryRunRendererExecutions: 0, rendererAvailability: laneState.availability,
        estimatedCost: null, costStatus: 'unknown', costNote: 'Fixture renderer; external cost not exercised.' }; },
      async render({ productionId, input }) {
        const artifact = await artifactService.createVersion({ artifactId: `production:${productionId}:master`,
          type: 'binary', content: Buffer.from('deterministic-v2.7-fixture-master'),
          idempotencyKey: `${productionId}:${input.fingerprint}:fixture-master`, provider: 'fixture-renderer',
          model: 'v2.7-local', validationStatus: 'awaiting_human_approval' });
        const probe = { durationMs: 10000, width: 1080, height: 1920, fps: 30,
          videoCodec: 'h264', audioCodec: 'aac', hasAudio: true };
        const media = { assetId: 'fixture-master', kind: 'video', contentType: 'video/mp4',
          provider: 'fixture-renderer', model: 'v2.7-local', requestId: null, artifact,
          mediaProbe: probe, provenance: { source: 'local-fixture' } };
        await reviews.registerMasterForReview({ productionId, brandId: input.brandId,
          master: { artifact, contentType: 'video/mp4', probe }, script: input.script, quality,
          mediaResults: [media], renderContext: { renderMode: 'FAST', renderer: 'moneyprinterturbo',
            rendererStatus: 'SUCCEEDED', cost: { status: 'unknown' }, provenance: { source: 'local-fixture' } } });
        return { productionId, assembly: { clips: [{ media }] }, master: { artifact, contentType: 'video/mp4', probe },
          mediaValidation: { status: 'PASS' }, quality };
      },
    };
    const liveService = new LiveProductionService({ db, artifactService, storageRoot, rendererRouter,
      storageValidator: async () => {}, schemaInspector: async () => ({ compatible: true, counts: { error: 0, warn: 0 }, issues: [] }),
      transactionProbe: async () => ({ passed: true, persisted: false }),
      storageProbe: async () => ({ passed: true, persisted: false }), logger: { info() {} } });
    const scheduled = [];
    const command = new ProductionCommandService({ repository, storage,
      env: { LIVE_PAID_GENERATION: 'true' }, actor: 'v2.7-postgres-certification',
      providers: [{ capability: 'FAST RENDERER', provider: 'MoneyPrinterTurbo', configured: true }],
      runtimeFactory: ({ config }) => ({ service: liveService, config }),
      configResolver: (env, input) => ({ live: env.LIVE_PAID_GENERATION === 'true', renderMode: input.renderMode,
        provider: 'moneyprinterturbo', model: 'fixture', storageRoot, workerId: 'v2.7-postgres-certification',
        fastRenderer: { renderer: 'moneyprinterturbo' } }), credentialCheck() {},
      scheduler: (task) => scheduled.push(Promise.resolve().then(task)), logger: { error() {} } });

    const expectedCanonical = buildOperatorProductionInput(request(), await repository.getBrand(BRAND_ID));

    const plan = await command.preflight(request());
    assert.equal(plan.preflightProviderExecutions, 0); assert.equal(plan.expectedExternalExecutions, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_1.productions')).rows[0].count, 0,
      'preflight transactional state must not persist');
    const created = await command.create(request(), { preflightId: plan.preflightId });
    const duplicate = await command.create(request(), { preflightId: plan.preflightId });
    assert.equal(duplicate.productionId, created.productionId, 'double submit must converge on one durable production');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_1.productions')).rows[0].count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_1.jobs')).rows[0].count, 1);
    assert.equal(externalProviderCalls, 0);
    const productionList = await repository.listProductions({ brandId: BRAND_ID });
    assert.equal(productionList.length, 1); assert.equal(productionList[0].renderMode, 'FAST');
    assert.equal(productionList[0].publicationStatus, 'DISABLED');
    assert.equal(productionList[0].jobStatus, 'QUEUED');

    const storedBeforeStart = await repository.getProduction(created.productionId, BRAND_ID);
    assert.deepEqual(storedBeforeStart.jobPayload.canonicalRawInput, expectedCanonical.canonicalRawInput,
      'PostgreSQL must preserve the exact canonical operator request');
    const rebuiltInput = operatorInputFromRaw(storedBeforeStart.jobPayload.canonicalRawInput);
    const expectedNormalized = { ...expectedCanonical.input }; delete expectedNormalized.fingerprint;
    const rebuiltNormalized = { ...rebuiltInput }; delete rebuiltNormalized.fingerprint;
    assert.deepEqual(rebuiltNormalized, expectedNormalized, 'stored canonical request must reproduce normalized execution input');
    assert.equal(rebuiltInput.fingerprint,
      storedBeforeStart.metadata.live_input_fingerprint, 'stored canonical raw input must reproduce the durable fingerprint');

    await command.start({ productionId: created.productionId, brandId: BRAND_ID, confirmation: true });
    await Promise.all(scheduled.splice(0));
    const detail = await repository.getProduction(created.productionId, BRAND_ID);
    assert.equal(detail.status, 'COMPLETED'); assert.equal(detail.jobStatus, 'COMPLETED');
    assert.equal(detail.jobPayload.canonicalRawInput.publication_policy.auto_publish, false);
    const artifacts = await repository.listArtifacts(created.productionId, BRAND_ID);
    assert.ok(artifacts.some((item) => item.type === 'MASTER' && item.validationStatus === 'PASS'));
    const queue = await repository.listReviews({ brandId: BRAND_ID });
    assert.equal(queue.length, 1); assert.equal(queue[0].renderMode, 'FAST');
    const decision = await reviews.decide({ reviewItemId: queue[0].id, brandId: BRAND_ID,
      decision: 'approve', actor: 'v2.7-postgres-certification' });
    assert.equal(decision.decision, 'APPROVED');
    assert.equal((await repository.listReviews({ brandId: BRAND_ID })).length, 0);
    assert.equal((await repository.listReviews({ brandId: BRAND_ID, includeDecided: true }))[0].publicationStatus,
      'DISABLED_PENDING_APPROVAL');

    const regenerated = await command.regenerate({ productionId: created.productionId, brandId: BRAND_ID,
      requestId: '40000000-0000-4000-8000-000000000004', reason: 'Faster pacing.' });
    assert.notEqual(regenerated.productionId, created.productionId); assert.equal(regenerated.requiresExplicitStart, true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_3.master_review_decisions')).rows[0].count, 1,
      'historic approval must remain immutable');
    assert.equal((await db.query('SELECT status FROM v2_1.productions WHERE id=$1', [regenerated.productionId])).rows[0].status, 'DRAFT');
    assert.equal(externalProviderCalls, 0);
    console.log('V2.7 disposable PostgreSQL operator-console E2E passed (fixture renderer, provider calls 0).');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_6 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_5 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_3 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE').catch(() => {});
    await db.end();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
