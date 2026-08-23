'use strict';

const assert = require('node:assert/strict');
const {
  LiveProductionService,
  buildStructuredLiveInput,
  resolveLiveConfiguration,
} = require('../src/v2.4/live-production-service');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND_ID = '99999999-9999-4999-8999-999999999999';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCTION_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const SAFE_PREFLIGHT = Object.freeze({
  schemaInspector: async () => ({ compatible: true, counts: { error: 0, warn: 0 }, issues: [] }),
  transactionProbe: async () => ({ passed: true, persisted: false }),
  storageProbe: async () => ({ passed: true, persisted: false }),
});

function rawInput(overrides = {}) {
  return {
    brand_id: BRAND_ID,
    live_test_key: 'v2.4-test-key',
    title: 'Controlled live test',
    objective: 'ORGANIC_REACH',
    hook: 'Imagine this.',
    cta: 'Explore now.',
    scene: { visual: 'Villa reveal', dialogue_or_voiceover: 'Imagine this. Explore now.' },
    shot: { shot_id: 'shot-1', framing: 'vertical wide', camera: 'push-in', subject: 'villa', action: 'reveal' },
    continuity: { characters: [], locations: ['villa'], products: ['property'], wardrobe: [], props: ['pool'], visual_style: 'premium realistic' },
    video: { asset_id: 'video-1', prompt: 'Premium villa at golden hour', resolution: '480p', aspect_ratio: '9:16', num_frames: 81, frames_per_second: 16, go_fast: true },
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    LIVE_PAID_GENERATION: 'false', VIDEO_PROVIDER: 'replicate', REPLICATE_API_TOKEN: 'never-print-this-token',
    DATABASE_URL: 'postgresql://test', CONTENT_FACTORY_STORAGE_ROOT: '/tmp/artifacts', LIVE_PRODUCTION_INPUT: '/tmp/input.json',
    ...overrides,
  };
}

class FakeDb {
  constructor() {
    this.brand = { id: BRAND_ID, name: 'Test Brand', workspaceId: WORKSPACE_ID };
    this.production = null; this.job = null; this.review = null; this.decisions = []; this.publications = [];
  }

  async query(sql, values = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('v2.4:database-health')) return { rows: [{}] };
    if (sql.includes('v2.4:get-brand')) return { rows: values[0] === this.brand.id ? [this.brand] : [] };
    if (sql.includes('v2.4:inspect-existing')) {
      if (!this.production) return { rows: [] };
      return { rows: [{ productionId: this.production.id, productionStatus: this.production.status, metadata: this.production.metadata,
        jobId: this.job?.id || null, jobStatus: this.job?.status || null, payload: this.job?.payload || {}, result: this.job?.result || {} }] };
    }
    if (sql.includes('v2.4:create-production')) {
      if (!this.production) this.production = { id: PRODUCTION_ID, workspace_id: values[0], brand_id: values[1], name: values[2], status: 'DRAFT', objective: values[3], metadata: JSON.parse(values[4]) };
      return { rows: [] };
    }
    if (sql.includes('v2.4:get-production-for-run')) return { rows: this.production ? [this.production] : [] };
    if (sql.includes('v2.4:create-live-job')) {
      if (!this.job) this.job = { id: JOB_ID, production_id: values[0], stage: 'EDIT', status: 'QUEUED', idempotency_key: values[1], payload: JSON.parse(values[2]), result: {} };
      return { rows: [] };
    }
    if (sql.includes('v2.4:get-live-job')) return { rows: this.job ? [this.job] : [] };
    if (sql.includes('v2.4:claim-live-job')) { this.job.status = 'RUNNING'; this.job.worker_id = values[1]; return { rows: [this.job] }; }
    if (sql.includes('v2.4:mark-provider-boundary')) { this.job.payload = { ...this.job.payload, ...JSON.parse(values[3]) }; return { rows: [this.job] }; }
    if (sql.includes('v2.4:get-pending-review')) return { rows: this.review ? [this.review] : [] };
    if (sql.includes('v2.4:complete-live-job')) { this.job.status = 'COMPLETED'; this.job.result = JSON.parse(values[3]); return { rows: [this.job] }; }
    if (sql.includes('v2.4:fail-live-job')) { this.job.status = values[4]; return { rows: [this.job] }; }
    if (sql.startsWith('UPDATE v2_1.productions')) { this.production.status = sql.includes("status='FAILED'") ? 'FAILED' : sql.includes("status='COMPLETED'") ? 'COMPLETED' : 'RUNNING'; return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function masterMock(db, calls) {
  return {
    async build(request) {
      calls.push(request);
      assert.equal(request.brandId, BRAND_ID);
      db.review = { id: 'review-1', status: 'AWAITING_HUMAN_APPROVAL' };
      return {
        assembly: { clips: [{ media: {
          provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast', requestId: 'prediction-1',
          provenance: { predictionId: 'prediction-1' },
          artifact: { artifactId: `brand:${BRAND_ID}:asset:video-1`, version: 1, storageKey: 'artifacts/video.bin' },
        } }] },
        master: { artifact: { artifactId: `production:${PRODUCTION_ID}:master`, version: 1, storageKey: 'artifacts/master.bin' } },
        quality: { status: 'PASS', readyForHumanReview: true, publicationAllowed: false },
      };
    },
  };
}

function artifactMock(calls = []) {
  return { async createVersion(input) {
    calls.push(input);
    return { artifactId: input.artifactId, version: 1, storageKey: 'artifacts/live-input.txt', contentHash: 'input-hash' };
  }, async getVersionByIdempotency() { return null; } };
}

async function main() {
  const input = buildStructuredLiveInput(rawInput());
  assert.equal(input.assetPlan.assets.length, 1);
  assert.equal(input.assetPlan.assets[0].kind, 'video');
  assert.equal(input.profile.resolution, '480p');
  assert.equal(input.profile.numFrames, 81);
  assert.equal(input.script.brand_id, BRAND_ID);

  assert.throws(() => resolveLiveConfiguration(environment({ LIVE_PAID_GENERATION: undefined })), (error) => error.code === 'LIVE_PAID_GATE_REQUIRED');
  assert.throws(() => resolveLiveConfiguration(environment({ REPLICATE_API_TOKEN: undefined })), (error) => error.code === 'LIVE_REPLICATE_TOKEN_REQUIRED');
  assert.throws(() => resolveLiveConfiguration(environment({ VIDEO_PROVIDER: 'nvidia' })), (error) => error.code === 'LIVE_PROVIDER_MISMATCH');
  assert.throws(() => buildStructuredLiveInput(rawInput({ live_test_key: '' })), (error) => error.code === 'LIVE_INPUT_INVALID');
  assert.throws(() => buildStructuredLiveInput(rawInput({ brand_id: 'bad' })), (error) => error.code === 'LIVE_INPUT_INVALID');
  assert.throws(() => buildStructuredLiveInput(rawInput({ video: { prompt: '' } })), (error) => error.code === 'LIVE_INPUT_INVALID');
  assert.throws(() => buildStructuredLiveInput(rawInput({ video: { ...rawInput().video, go_fast: 'false' } })), (error) => error.code === 'LIVE_INPUT_INVALID');

  const dryDb = new FakeDb(); const dryCalls = []; const logs = [];
  const dryArtifactCalls = [];
  const dryService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: dryDb, masterOrchestrator: masterMock(dryDb, dryCalls), artifactService: artifactMock(dryArtifactCalls), storageRoot: '/tmp/artifacts', storageValidator: async () => {}, logger: { info: (...args) => logs.push(args) } });
  const dry = await dryService.run({ input, config: resolveLiveConfiguration(environment()) });
  assert.equal(dry.dryRun, true); assert.equal(dry.plan.expectedVideoGenerations, 1); assert.equal(dryCalls.length, 0, 'dry-run must not call paid provider path');
  assert.doesNotMatch(JSON.stringify(logs), /never-print-this-token/, 'operator summary must not expose token');
  assert.equal(dryDb.production, null, 'dry-run must not create durable execution state');
  assert.equal(dryArtifactCalls.length, 0, 'dry-run must not create artifacts');

  const missingBrandDb = new FakeDb(); missingBrandDb.brand.id = OTHER_BRAND_ID;
  const missingBrandService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: missingBrandDb, masterOrchestrator: masterMock(missingBrandDb, []), artifactService: artifactMock(), storageRoot: '/tmp/artifacts', storageValidator: async () => {} });
  await assert.rejects(() => missingBrandService.run({ input, config: resolveLiveConfiguration(environment()) }), (error) => error.code === 'LIVE_BRAND_NOT_FOUND');

  const liveDb = new FakeDb(); const liveCalls = [];
  const inputArtifacts = [];
  const liveService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: liveDb, masterOrchestrator: masterMock(liveDb, liveCalls), artifactService: artifactMock(inputArtifacts), storageRoot: '/tmp/artifacts', storageValidator: async () => {}, logger: { info() {} } });
  const liveConfig = resolveLiveConfiguration(environment({ LIVE_PAID_GENERATION: 'true' }));
  const first = await liveService.run({ input, config: liveConfig });
  assert.equal(first.productionId, PRODUCTION_ID);
  assert.equal(first.validationStatus, 'PASS');
  assert.equal(first.reviewStatus, 'AWAITING_HUMAN_APPROVAL');
  assert.equal(first.provider, 'replicate'); assert.equal(first.predictionId, 'prediction-1');
  assert.equal(first.publicationTriggered, false); assert.equal(liveDb.decisions.length, 0, 'approval must remain manual');
  assert.equal(liveDb.publications.length, 0, 'publication must never be called');
  assert.equal(first.inputArtifact.id, `production:${PRODUCTION_ID}:live-input`);
  const duplicate = await liveService.run({ input, config: liveConfig });
  assert.equal(duplicate.reused, true); assert.equal(duplicate.paidGenerationPerformed, false);
  assert.equal(liveCalls.length, 1, 'duplicate live_test_key must not create a second paid generation');
  assert.equal(inputArtifacts.length, 1, 'duplicate successful run must reuse immutable input and result');

  const changed = buildStructuredLiveInput(rawInput({ title: 'Changed input' }));
  await assert.rejects(() => liveService.run({ input: changed, config: liveConfig }), (error) => error.code === 'LIVE_INPUT_CONFLICT');
  assert.equal(liveCalls.length, 1);

  const runningDb = new FakeDb();
  runningDb.production = { id: PRODUCTION_ID, workspace_id: WORKSPACE_ID, brand_id: BRAND_ID, name: `v2.4-live:${input.liveTestKey}`, status: 'RUNNING', metadata: { live_input_fingerprint: input.fingerprint } };
  runningDb.job = { id: JOB_ID, production_id: PRODUCTION_ID, status: 'RUNNING', result: {} };
  const runningCalls = [];
  const runningService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: runningDb, masterOrchestrator: masterMock(runningDb, runningCalls), artifactService: artifactMock(), storageRoot: '/tmp/artifacts', storageValidator: async () => {}, logger: { info() {} } });
  await assert.rejects(() => runningService.run({ input, config: liveConfig }), (error) => error.code === 'LIVE_RUN_NOT_RETRYABLE');
  assert.equal(runningCalls.length, 0, 'in-progress durable run must not create a second prediction');

  runningDb.job.status = 'RETRYING';
  await assert.rejects(() => runningService.run({ input, config: liveConfig }), (error) => error.code === 'LIVE_EXISTING_PREDICTION_UNRESOLVED');
  assert.equal(runningCalls.length, 0, 'recovered run without immutable media must fail closed');

  const blockedDb = new FakeDb();
  const blockedCalls = [];
  const blockedService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: blockedDb, masterOrchestrator: masterMock(blockedDb, blockedCalls),
    artifactService: artifactMock(), storageRoot: '/tmp/artifacts', storageValidator: async () => {},
    schemaInspector: async () => ({ compatible: false, counts: { error: 1, warn: 0 }, issues: [{ code: 'LEGACY_BRAND_FK_ACTIVE' }] }) });
  await assert.rejects(() => blockedService.run({ input, config: liveConfig }), (error) => error.code === 'LIVE_SCHEMA_INCOMPATIBLE');
  assert.equal(blockedCalls.length, 0, 'schema incompatibility must block before provider boundary');

  const preProviderDb = new FakeDb(); const preProviderCalls = []; let inputAttempts = 0;
  const preProviderArtifacts = artifactMock();
  preProviderArtifacts.createVersion = async (request) => {
    inputAttempts += 1;
    if (inputAttempts === 1) throw Object.assign(new Error('local storage unavailable'), { code: 'LOCAL_STORAGE_ERROR' });
    return { artifactId: request.artifactId, version: 1, storageKey: 'artifacts/live-input.txt', contentHash: 'input-hash' };
  };
  const preProviderService = new LiveProductionService({ ...SAFE_PREFLIGHT, db: preProviderDb,
    masterOrchestrator: masterMock(preProviderDb, preProviderCalls), artifactService: preProviderArtifacts,
    storageRoot: '/tmp/artifacts', storageValidator: async () => {}, logger: { info() {} } });
  await assert.rejects(() => preProviderService.run({ input, config: liveConfig }), /local storage unavailable/);
  assert.equal(preProviderDb.job.status, 'RETRYING');
  assert.equal(preProviderDb.job.payload.providerRequestState, 'NOT_STARTED');
  const recovered = await preProviderService.run({ input, config: liveConfig });
  assert.equal(recovered.validationStatus, 'PASS');
  assert.equal(preProviderCalls.length, 1, 'failure before durable provider boundary may safely retry once');
  console.log('V2.4 controlled live production boundary passed (zero paid API calls).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
