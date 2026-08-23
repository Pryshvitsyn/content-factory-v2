'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ControlReviewService } = require('../src/v2.3/control-review-service');
const { LiveProductionService, buildStructuredLiveInput } = require('../src/v2.4/live-production-service');
const { inspectSchemaCompatibility, verifyTransactionalLiveWrites } = require('../src/v2.4/schema-compatibility');
const { prepareDatabase } = require('../scripts/prepare-local-live-production');

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_WORKSPACE_ID = '10000000-0000-4000-8000-000000000099';
const BRAND_ID = '20000000-0000-4000-8000-000000000002';
const LEGACY_BRAND_ID = '30000000-0000-4000-8000-000000000003';
const LEGACY_VARIANT_ID = '40000000-0000-4000-8000-000000000004';
const LEGACY_PRODUCTION_ID = '50000000-0000-4000-8000-000000000005';
const databaseUrl = process.env.DATABASE_URL && !/(?:USER|PASSWORD|HOST)/.test(process.env.DATABASE_URL)
  ? process.env.DATABASE_URL : undefined;

const db = new Pool({
  connectionString: databaseUrl,
  host: databaseUrl ? undefined : process.env.PGHOST || '127.0.0.1',
  port: databaseUrl ? undefined : Number(process.env.PGPORT || 5432),
  user: databaseUrl ? undefined : process.env.PGUSER || 'postgres',
  password: databaseUrl ? undefined : process.env.PGPASSWORD || 'postgres',
  database: databaseUrl ? undefined : process.env.PGDATABASE || 'content_os',
});

function configuredDatabaseName() {
  if (databaseUrl) return new URL(databaseUrl).pathname.replace(/^\//, '');
  return process.env.PGDATABASE || 'content_os';
}

function testDatabaseUrl() {
  if (databaseUrl) return databaseUrl;
  const user = encodeURIComponent(process.env.PGUSER || 'postgres');
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  const host = process.env.PGHOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || 5432);
  return `postgresql://${user}${password}@${host}:${port}/${encodeURIComponent(configuredDatabaseName())}`;
}

function assertDisposableDatabase() {
  const database = configuredDatabaseName();
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || database === 'content_os') {
    const error = new Error(
      'This destructive fixture test requires CONTENT_FACTORY_TEST_DATABASE=1 and a dedicated database other than content_os.',
    );
    error.code = 'TEST_DATABASE_NOT_EXPLICIT';
    throw error;
  }
}

async function createLegacyFixture() {
  await db.query('DROP SCHEMA IF EXISTS v2_3 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS public.brands CASCADE');
  await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE');
  await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query(`CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`CREATE TABLE public.generation_jobs(id uuid PRIMARY KEY)`);
  await db.query(`CREATE TABLE public.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id),name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`INSERT INTO public.workspaces(id,name) VALUES($1,'Legacy workspace'),($2,'Other workspace')`, [WORKSPACE_ID, OTHER_WORKSPACE_ID]);
  await db.query(`INSERT INTO public.brands(id,workspace_id,name) VALUES($1,$2,'Attune fixture')`, [BRAND_ID, WORKSPACE_ID]);

  await db.query('CREATE SCHEMA v2_1');
  await db.query(`CREATE TABLE v2_1.tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'ACTIVE',metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`CREATE TABLE v2_1.businesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES v2_1.tenants(id),
    name text NOT NULL,industry text,status text NOT NULL DEFAULT 'ACTIVE',rules jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,name))`);
  await db.query(`CREATE TABLE v2_1.brands(id uuid PRIMARY KEY,business_id uuid NOT NULL,name text NOT NULL,
    voice jsonb NOT NULL DEFAULT '{}',visual_identity jsonb NOT NULL DEFAULT '{}',rules jsonb NOT NULL DEFAULT '{}',
    compliance_rules jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id,name),FOREIGN KEY(business_id) REFERENCES v2_1.businesses(id))`);
  const legacyTenant = await db.query(`INSERT INTO v2_1.tenants(name) VALUES('Legacy tenant') RETURNING id`);
  const legacyBusiness = await db.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,'Legacy business') RETURNING id`, [legacyTenant.rows[0].id]);
  await db.query(`INSERT INTO v2_1.brands(id,business_id,name) VALUES($1,$2,'Legacy-only brand')`, [LEGACY_BRAND_ID, legacyBusiness.rows[0].id]);
  await db.query(`CREATE TABLE v2_1.projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',
    config jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    tenant_id uuid REFERENCES v2_1.tenants(id),business_id uuid REFERENCES v2_1.businesses(id),brand_id uuid REFERENCES v2_1.brands(id),series_id uuid)`);
  await db.query(`CREATE TABLE v2_1.content_variants(id uuid PRIMARY KEY)`);
  await db.query(`INSERT INTO v2_1.content_variants(id) VALUES($1)`, [LEGACY_VARIANT_ID]);
  await db.query(`CREATE TABLE v2_1.productions(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_variant_id uuid NOT NULL REFERENCES v2_1.content_variants(id),
    production_version integer NOT NULL DEFAULT 1,tenant_id uuid REFERENCES v2_1.tenants(id),business_id uuid REFERENCES v2_1.businesses(id),
    brand_id uuid,project_id uuid REFERENCES v2_1.projects(id),status text NOT NULL DEFAULT 'DRAFT',metadata jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT productions_brand_fk FOREIGN KEY(brand_id) REFERENCES v2_1.brands(id),
    CONSTRAINT productions_status_check CHECK(status IN('DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED')))`);
  await db.query(`CREATE FUNCTION v2_1.enforce_production_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE project_row record; brand_business uuid; business_tenant uuid;
    BEGIN
      IF NEW.tenant_id IS NULL OR NEW.business_id IS NULL OR NEW.brand_id IS NULL OR NEW.project_id IS NULL THEN
        IF NEW.status IN ('RUNNING','COMPLETED') THEN RAISE EXCEPTION 'Production % cannot run without tenant, business, brand and project ownership',NEW.id; END IF;
        RETURN NEW;
      END IF;
      SELECT id,tenant_id,business_id INTO project_row FROM v2_1.projects WHERE id=NEW.project_id;
      IF NOT FOUND OR project_row.tenant_id IS DISTINCT FROM NEW.tenant_id OR project_row.business_id IS DISTINCT FROM NEW.business_id THEN
        RAISE EXCEPTION 'Production ownership does not match project ownership';
      END IF;
      SELECT tenant_id INTO business_tenant FROM v2_1.businesses WHERE id=NEW.business_id;
      IF business_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Production business does not belong to production tenant'; END IF;
      SELECT business_id INTO brand_business FROM v2_1.brands WHERE id=NEW.brand_id;
      IF brand_business IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'Production brand does not belong to production business'; END IF;
      RETURN NEW;
    END $$`);
  await db.query(`CREATE TRIGGER trg_productions_boundary BEFORE INSERT OR UPDATE ON v2_1.productions
    FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_production_boundary()`);
  await db.query(`INSERT INTO v2_1.productions(id,content_variant_id,brand_id) VALUES($1,$2,$3)`, [LEGACY_PRODUCTION_ID, LEGACY_VARIANT_ID, LEGACY_BRAND_ID]);

  await db.query(`CREATE TABLE v2_1.jobs(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_id uuid REFERENCES v2_1.productions(id),job_type text,status text NOT NULL DEFAULT 'QUEUED',
    priority integer NOT NULL DEFAULT 0,idempotency_key text NOT NULL UNIQUE,attempts integer NOT NULL DEFAULT 0,input jsonb NOT NULL DEFAULT '{}',
    output jsonb NOT NULL DEFAULT '{}',next_attempt_at timestamptz NOT NULL DEFAULT now(),max_attempts integer NOT NULL DEFAULT 5,
    CONSTRAINT jobs_status_check CHECK(status IN('QUEUED','RUNNING','COMPLETED','FAILED','RETRYING','CANCELLED')))`);
  await db.query(`CREATE TABLE v2_1.stage_runs(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES v2_1.jobs(id),stage text NOT NULL,attempt integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'QUEUED',input_artifacts jsonb NOT NULL DEFAULT '[]',output_artifacts jsonb NOT NULL DEFAULT '[]',
    max_attempts integer NOT NULL DEFAULT 3,next_attempt_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,stage,attempt),
    CONSTRAINT stage_runs_status_check CHECK(status IN('QUEUED','RUNNING','COMPLETED','FAILED','RETRYING','CANCELLED')))`);
  await db.query(`CREATE TABLE v2_1.stage_definitions(stage text PRIMARY KEY)`);
  await db.query(`CREATE TABLE v2_1.concurrency_certifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope text NOT NULL,subject_id uuid NOT NULL,
    contender_count integer NOT NULL,successful_claims integer NOT NULL,certified boolean NOT NULL,details jsonb NOT NULL DEFAULT '{}')`);
  await db.query(`CREATE TABLE v2_1.editions(id uuid PRIMARY KEY)`);
  await db.query(`CREATE TABLE v2_1.publications(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),edition_id uuid NOT NULL REFERENCES v2_1.editions(id),platform text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',scheduled_at timestamptz,published_at timestamptz,external_id text,metadata jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT publications_status_check CHECK(status IN('DRAFT','SCHEDULED','PUBLISHED','FAILED','CANCELLED')))`);
  await db.query(`CREATE TABLE v2_1.asset_registry(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id text NOT NULL,kind text NOT NULL,semantic_key text NOT NULL,
    artifact_storage_key text NOT NULL,artifact_version integer NOT NULL,status text NOT NULL DEFAULT 'READY',created_by text NOT NULL)`);
  await db.query(`CREATE FUNCTION v2_1.claim_job(text,integer) RETURNS TABLE(id uuid) LANGUAGE sql AS $$ SELECT NULL::uuid WHERE false $$`);
}

async function createCleanFixture() {
  await db.query('DROP SCHEMA IF EXISTS v2_3 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE');
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('DROP TABLE IF EXISTS public.brands CASCADE');
  await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE');
  await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE');
  await db.query(`CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`CREATE TABLE public.generation_jobs(id uuid PRIMARY KEY)`);
  await db.query(`CREATE TABLE public.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id),name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`INSERT INTO public.workspaces(id,name) VALUES($1,'Clean workspace')`, [WORKSPACE_ID]);
  await db.query(`INSERT INTO public.brands(id,workspace_id,name) VALUES($1,$2,'Attune clean fixture')`, [BRAND_ID, WORKSPACE_ID]);
}

function rawInput() {
  return {
    brand_id: BRAND_ID, live_test_key: 'legacy-upgrade-e2e', title: 'Legacy upgrade proof', objective: 'ORGANIC_REACH',
    hook: 'A safe upgrade.', cta: 'Review the master.', scene: { visual: 'Minimal test card', dialogue_or_voiceover: 'A safe upgrade. Review the master.' },
    shot: { shot_id: 'shot-1', framing: 'vertical wide', camera: 'static', subject: 'test card', action: 'hold' },
    continuity: { characters: [], locations: ['test'], products: [], wardrobe: [], props: [], visual_style: 'minimal test fixture' },
    video: { asset_id: 'video-1', prompt: 'Synthetic mocked vertical video', resolution: '480p', aspect_ratio: '9:16', num_frames: 81, frames_per_second: 16, go_fast: true },
  };
}

function input() { return buildStructuredLiveInput(rawInput()); }

async function main() {
  assertDisposableDatabase();
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-v24-legacy-'));
  try {
    await createLegacyFixture();
    const legacyBefore = await db.query(`SELECT content_variant_id,brand_id FROM v2_1.productions WHERE id=$1`, [LEGACY_PRODUCTION_ID]);
    await prepareDatabase(db);
    const objectsAfterFirst = await db.query(`SELECT
      (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE '%v24%') AS constraints,
      (SELECT count(*)::int FROM pg_indexes WHERE schemaname='v2_1' AND indexname LIKE 'uq_v21_%') AS indexes`);
    await prepareDatabase(db); // repeatability/idempotency
    const objectsAfterSecond = await db.query(`SELECT
      (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE '%v24%') AS constraints,
      (SELECT count(*)::int FROM pg_indexes WHERE schemaname='v2_1' AND indexname LIKE 'uq_v21_%') AS indexes`);
    assert.deepEqual(objectsAfterSecond.rows, objectsAfterFirst.rows, 'compatibility migration must not accumulate schema objects');

    const report = await inspectSchemaCompatibility(db);
    assert.equal(report.compatible, true, JSON.stringify(report.issues, null, 2));
    assert.ok(report.issues.some((item) => item.code === 'CANONICAL_BRAND_FK_NOT_VALIDATED'), 'legacy brand rows should keep canonical FK NOT VALID');
    const legacyAfter = await db.query(`SELECT content_variant_id,brand_id FROM v2_1.productions WHERE id=$1`, [LEGACY_PRODUCTION_ID]);
    assert.deepEqual(legacyAfter.rows, legacyBefore.rows, 'legacy production identity must be preserved');
    const brandFk = await db.query(`SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='v2_1.productions'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (brand_id)%'`);
    assert.equal(brandFk.rowCount, 1);
    assert.match(brandFk.rows[0].definition, /REFERENCES v2_2\.brands\(id\)/);
    assert.equal(brandFk.rows[0].convalidated, false);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_2.brands WHERE id=$1 AND workspace_id=$2`, [BRAND_ID, WORKSPACE_ID])).rows[0].count, 1);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.brands WHERE id=$1`, [BRAND_ID])).rows[0].count, 0,
      'compatibility must not duplicate the canonical V2.2 brand into the legacy ownership model');
    const ownershipGuard = await db.query(`SELECT pg_get_functiondef(tg.tgfoid) AS definition FROM pg_trigger tg
      WHERE tg.tgrelid='v2_1.productions'::regclass AND tg.tgname='trg_productions_boundary'`);
    assert.match(ownershipGuard.rows[0].definition, /v2_2\.brands/, 'production guard must enforce canonical V2.2 ownership');
    assert.equal((await db.query(`SELECT pg_get_function_result('v2_1.claim_job(text,integer)'::regprocedure) AS result`)).rows[0].result, 'SETOF v2_1.jobs');

    await verifyTransactionalLiveWrites(db, { workspaceId: WORKSPACE_ID, brandId: BRAND_ID, objective: 'ORGANIC_REACH' });
    await assert.rejects(() => db.query(`INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,metadata)
      VALUES($1,$2,'cross-brand-probe','DRAFT','{}')`, [OTHER_WORKSPACE_ID, BRAND_ID]),
    /workspace does not own canonical brand/);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.productions WHERE name LIKE 'v2.4-preflight:%'`)).rows[0].count, 0,
      'transactional pre-paid probe must roll back all writes');
    const inputFile = path.join(storageRoot, 'operator-input.json');
    await fs.writeFile(inputFile, JSON.stringify(rawInput()), 'utf8');
    const dryRun = spawnSync(process.execPath, ['scripts/live-production.js'], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(), LIVE_PAID_GENERATION: 'false', VIDEO_PROVIDER: 'replicate', REPLICATE_API_TOKEN: 'synthetic-test-token',
        CONTENT_FACTORY_STORAGE_ROOT: storageRoot, LIVE_PRODUCTION_INPUT: inputFile },
    });
    assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
    assert.match(dryRun.stdout, /DRY RUN PASSED/);
    assert.doesNotMatch(`${dryRun.stdout}${dryRun.stderr}`, /synthetic-test-token/);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.productions WHERE name LIKE 'v2.4-live:%'`)).rows[0].count, 0,
      'CLI dry-run must not persist a production');
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifacts = new ArtifactService({ storage });
    const reviews = new ControlReviewService({ db });
    let mockedGenerations = 0;
    const masterOrchestrator = { async build(request) {
      mockedGenerations += 1;
      const video = await artifacts.createVersion({ artifactId: `brand:${BRAND_ID}:asset:video-1`, type: 'binary', content: Buffer.from('mock-video'),
        idempotencyKey: `${request.productionId}:mock-video`, provider: 'mock-replicate', model: 'wan-video/wan-2.2-t2v-fast', validationStatus: 'pending_master_validation' });
      const master = await artifacts.createVersion({ artifactId: `production:${request.productionId}:master`, type: 'binary', content: Buffer.from('mock-master'),
        idempotencyKey: `${request.productionId}:mock-master`, provider: 'ffmpeg-mock', model: '1080x1920', validationStatus: 'awaiting_human_approval' });
      const quality = { status: 'PASS', score: 1, checks: [{ code: 'fixture', status: 'PASS' }], readyForHumanReview: true, publicationAllowed: false };
      const media = { assetId: 'video-1', kind: 'video', provider: 'mock-replicate', model: 'wan-video/wan-2.2-t2v-fast', requestId: 'mock-prediction',
        provenance: { predictionId: 'mock-prediction' }, artifact: video };
      const masterValue = { artifact: master, contentType: 'video/mp4', probe: { durationMs: 5063 } };
      await reviews.registerMasterForReview({ productionId: request.productionId, brandId: BRAND_ID, master: masterValue, script: request.script, quality, mediaResults: [media] });
      return { assembly: { clips: [{ media }] }, master: masterValue, quality };
    } };
    const service = new LiveProductionService({ db, masterOrchestrator, artifactService: artifacts, storageRoot, logger: { info() {} } });
    const config = { live: true, provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast', workerId: 'v2.4-legacy-fixture' };
    const result = await service.run({ input: input(), config });
    assert.equal(result.validationStatus, 'PASS');
    assert.equal(result.reviewStatus, 'AWAITING_HUMAN_APPROVAL');
    assert.equal(result.publicationTriggered, false);
    const duplicate = await service.run({ input: input(), config });
    assert.equal(duplicate.reused, true);
    assert.equal(mockedGenerations, 1, 'same live key must not issue a second mocked generation');
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_3.master_review_decisions`)).rows[0].count, 0);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.publications WHERE publication_key IS NOT NULL`)).rows[0].count, 0);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM v2_1.productions WHERE name LIKE 'v2.4-preflight:%'`)).rows[0].count, 0);

    await createCleanFixture();
    await prepareDatabase(db);
    const cleanReport = await inspectSchemaCompatibility(db);
    assert.equal(cleanReport.compatible, true, JSON.stringify(cleanReport.issues, null, 2));
    await verifyTransactionalLiveWrites(db, { workspaceId: WORKSPACE_ID, brandId: BRAND_ID, objective: 'ORGANIC_REACH' });
    console.log('V2.4 legacy schema compatibility + no-paid durable production integration passed.');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_3 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_2 CASCADE').catch(() => {});
    await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.brands CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.generation_jobs CASCADE').catch(() => {});
    await db.query('DROP TABLE IF EXISTS public.workspaces CASCADE').catch(() => {});
    await db.end();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
