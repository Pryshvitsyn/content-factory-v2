'use strict';

const assert = require('node:assert/strict');
const { ProductionCommandService } = require('../src/v2.7/production-command-service');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { resolveQualityVideoProfile } = require('../src/v2.7/quality-video-profile');
const { operationalStatus, progressFor } = require('../apps/dashboard/server/control-service');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function operatorRequest(overrides = {}) {
  return { requestId: REQUEST_ID, brandId: BRAND_ID, renderMode: 'QUALITY', title: 'Attune — Notice',
    objective: 'ENGAGEMENT', platform: 'Instagram Reels', targetDurationSeconds: 10, aspectRatio: '9:16',
    hook: 'Silence can feel like distance.', coreMessage: 'Attention creates understanding.',
    creativeBrief: 'A believable human moment moves from assumption to attention.', cta: "Don't guess. Tune in.",
    sceneIdeas: 'A quiet ambiguous beat;A small attentive gesture', visualDirection: 'Natural tungsten evening light.',
    additionalInstructions: 'Keep performance restrained.',
    captionsEnabled: false, musicEnabled: false, ...overrides };
}

async function main() {
  const brand = { id: BRAND_ID, workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Attune', status: 'ACTIVE',
    mission: 'Help people understand each other.', positioning: 'Emotionally intelligent guidance.',
    products: [], audiences: [], offers: [], campaigns: [], knowledge: [] };
  const productions = new Map();
  const reviews = [{ productionId: 'historic-production', decision: 'APPROVE', artifactVersion: 1 }];
  let providerInvocations = 0;
  let next = 0;
  let ambiguousExecutions = 0;
  const shotRegenerations = new Map();
  const generatedShotAssets = new Set();
  const repository = {
    db: {},
    getBrand: async (id) => id === BRAND_ID ? brand : null,
    getCommandProduction: async (id, scopedBrand) => {
      const item = productions.get(id);
      return item && item.brandId === scopedBrand ? item : null;
    },
    executionSafety: async () => ({ ambiguousExecutions, actualProviderCalls: providerInvocations }),
    latestShotRevision: async () => [...shotRegenerations.values()].filter((item) => item.status === 'SUCCEEDED').at(-1) || null,
    nextShotRevision: async (_productionId, shotId) => [...shotRegenerations.values()].filter((item) => item.shotId === shotId).length + 1,
    getShotRegenerationByRequest: async (_productionId, requestId) => shotRegenerations.get(requestId) || null,
    ensureShotRegeneration: async (record) => {
      const prior = shotRegenerations.get(record.requestId);
      if (prior) return prior;
      const item = { ...record, inputFingerprint: record.inputFingerprint,
        id: `shot-regen-${shotRegenerations.size + 1}`, status: 'PREPARED' };
      shotRegenerations.set(record.requestId, item); return item;
    },
    claimShotRegeneration: async (id) => {
      const item = [...shotRegenerations.values()].find((value) => value.id === id);
      if (!item || !['PREPARED','RETRYING'].includes(item.status)) return null;
      item.status = 'RUNNING'; return item;
    },
    completeShotRegeneration: async (id, result) => {
      const item = [...shotRegenerations.values()].find((value) => value.id === id);
      item.status = 'SUCCEEDED'; item.result = result; item.canonicalRawInput = item.canonicalRawInput;
    },
    failShotRegeneration: async (id, error) => {
      const item = [...shotRegenerations.values()].find((value) => value.id === id);
      item.status = 'RETRYING'; item.error = error;
    },
  };
  const runtimeFactory = ({ config }) => {
    const serviceApi = {
    async prepare({ input }) {
      return { input: { ...input, workspaceId: brand.workspaceId }, plan: {
        brand: `${brand.name} (${brand.id})`, targetDurationSeconds: input.targetDurationSeconds,
        renderMode: input.renderMode, renderer: input.renderer, provider: input.renderMode === 'QUALITY' ? 'replicate' : null,
        model: input.renderMode === 'QUALITY' ? 'wan-test' : null, aspectRatio: input.aspectRatio,
        expectedVideoGenerations: input.renderMode === 'QUALITY' ? 2 : 0,
        expectedAudioGenerations: input.renderMode === 'QUALITY' ? 1 : 0,
        expectedPaidProviderCalls: input.renderMode === 'QUALITY' ? 3 : 0,
        expectedRendererJobs: input.renderMode === 'FAST' ? 1 : 0,
        expectedExternalServiceCalls: input.renderMode === 'FAST' ? 1 : 3,
        rendererAvailability: { status: 'READY' }, estimatedCost: null, costStatus: 'unknown',
        publicationPolicy: input.publicationPolicy, dryRunProviderCalls: 0,
        dryRunRendererExecutions: 0, providerExecutions: 0, schemaCompatibility: 'READY',
      } };
    },
    async createDraft({ input, command }) {
      const existing = [...productions.values()].find((item) => item.jobPayload.operatorRequestId === command.requestId);
      if (existing) return { production: existing, job: { id: existing.jobId, status: existing.jobStatus }, reused: true };
      next += 1;
      const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
      const item = { id, brandId: input.brandId, renderMode: input.renderMode, status: 'DRAFT', jobId: `job-${next}`, jobStatus: 'QUEUED',
        metadata: { source: command.source }, jobPayload: { operatorRequestId: command.requestId,
          canonicalRawInput: command.canonicalRawInput, canonicalRequest: command.canonicalRequest },
        regenerationOf: command.regenerationOf || null };
      productions.set(id, item);
      return { production: item, job: { id: item.jobId, status: item.jobStatus }, reused: false };
    },
    async run({ input }) {
      providerInvocations += input.renderMode === 'QUALITY' ? 3 : 1;
      const item = [...productions.values()].find((production) => production.jobPayload.canonicalRawInput.production_key === input.productionKey);
      if (item) { item.status = 'COMPLETED'; item.jobStatus = 'COMPLETED'; reviews.push({ productionId: item.id, decision: null, artifactVersion: 1 }); }
      return { publicationTriggered: false };
    },
    async prepareRevision({ input, productionId }) {
      return { brand, input: { ...input, workspaceId: brand.workspaceId }, existing: { productionId }, plan: {
        provider: input.qualityVideoProfile.provider, model: input.qualityVideoProfile.model,
        resolution: input.qualityVideoProfile.resolution, expectedVideoGenerations: 1,
        expectedAudioGenerations: 0, expectedPaidProviderCalls: 1,
      } };
    },
    };
    return { service: serviceApi, rendererRouter: { async render({ assetPlan }) {
      const replacement = assetPlan.assets.find((asset) => asset.asset_id.includes('-rev-'))?.asset_id;
      if (replacement && !generatedShotAssets.has(replacement)) { providerInvocations += 1; generatedShotAssets.add(replacement); }
      return { master: { artifact: { artifactId: 'production:master', version: 2, storageKey: 'master-v2.mp4' } },
        quality: { status: 'PASS', readyForHumanReview: true } };
    } }, config };
  };
  const configResolver = (env, input) => ({ live: env.LIVE_PAID_GENERATION === 'true', renderMode: input.renderMode,
    provider: input.renderMode === 'QUALITY' ? 'replicate' : 'moneyprinterturbo', model: 'test',
    storageRoot: '/tmp/v27-test', workerId: 'v27-test', fastRenderer: { renderer: 'moneyprinterturbo' } });
  const providers = [
    { capability: 'FAST RENDERER', provider: 'MoneyPrinterTurbo', configured: true },
    { capability: 'VIDEO', provider: 'Replicate', model: 'test-owner/quality-video', configured: true },
    { capability: 'SPEECH', provider: 'OpenAI', configured: true },
  ];
  const productionProfile = resolveQualityVideoProfile({ QUALITY_VIDEO_MODEL: 'test-owner/quality-video' });
  const plannedA = buildOperatorProductionInput(operatorRequest(), brand, { qualityProfile: productionProfile });
  const plannedB = buildOperatorProductionInput(operatorRequest(), brand, { qualityProfile: productionProfile });
  assert.deepEqual(plannedA.input.creativePlan, plannedB.input.creativePlan, 'creative planning must be deterministic');
  assert.equal(plannedA.input.creativePlan.brandBrain.status, 'AVAILABLE');
  assert.equal(plannedA.input.creativePlan.operatorBriefAuthoritative, true);
  assert.equal(plannedA.input.creativePlan.shots.length, 2);
  assert.notEqual(plannedA.input.creativePlan.shots[0].purpose, plannedA.input.creativePlan.shots[1].purpose);
  assert.ok(plannedA.input.creativePlan.shots.every((shot) => shot.generationPrompt
    && shot.negativeGuidance.length && shot.continuityIdentity));
  assert.ok(plannedA.input.assetPlan.assets.filter((asset) => asset.kind === 'video')
    .every((asset) => !asset.generation_requirements.prompt.includes(operatorRequest().creativeBrief)),
  'the full operator brief must not be mechanically repeated in every provider prompt');
  assert.equal(plannedA.input.profile.resolution, '720p');
  assert.equal(plannedA.input.profile.go_fast, false);
  assert.equal(plannedA.input.profile.optimize_prompt, true);
  const emptyBrain = buildOperatorProductionInput(operatorRequest(), { ...brand, mission: null, positioning: null },
    { qualityProfile: productionProfile });
  assert.equal(emptyBrain.input.creativePlan.brandBrain.status, 'EMPTY_OPERATOR_ONLY');
  assert.match(emptyBrain.input.creativePlan.shots[0].generationPrompt, /Brand Brain is empty/);
  assert.throws(() => resolveQualityVideoProfile({}), (error) => error.code === 'QUALITY_MODEL_REQUIRED');
  const qualityEnv = { LIVE_PAID_GENERATION: 'true', QUALITY_VIDEO_MODEL: 'test-owner/quality-video' };
  const service = new ProductionCommandService({ repository, storage: {}, env: qualityEnv,
    providers, runtimeFactory, configResolver, credentialCheck() {}, scheduler: (task) => task(),
    logger: { error() {} } });

  const qualityPreflight = await service.preflight(operatorRequest());
  assert.equal(qualityPreflight.preflightProviderExecutions, 0);
  assert.equal(qualityPreflight.expectedVideoGenerations, 2);
  assert.equal(qualityPreflight.expectedAudioGenerations, 1);
  assert.equal(qualityPreflight.expectedProviderCalls, 3);
  assert.equal(providerInvocations, 0, 'preflight must not invoke provider execution');
  assert.equal(qualityPreflight.autoPublish, false);
  assert.equal(qualityPreflight.humanApprovalRequired, true);
  assert.equal(operationalStatus({ reviewState: 'APPROVED' }), 'APPROVED');
  assert.equal(operationalStatus({ reviewState: 'REJECTED' }), 'REJECTED');
  assert.equal(progressFor({ reviewState: 'APPROVED', canonicalRequest: {}, jobId: 'job',
    jobStatus: 'COMPLETED', validationStatus: 'PASS' }).at(-1).status, 'COMPLETED');

  await assert.rejects(() => service.preflight(operatorRequest({ brandId: '44444444-4444-4444-8444-444444444444' })),
    (error) => error.code === 'BRAND_NOT_FOUND');
  await assert.rejects(() => service.preflight(operatorRequest({ renderMode: 'MAGIC' })),
    (error) => error.code === 'V27_INPUT_INVALID');
  const unavailable = new ProductionCommandService({ repository, storage: {}, env: qualityEnv,
    providers: providers.filter((item) => item.capability !== 'FAST RENDERER'), runtimeFactory, configResolver,
    credentialCheck() {}, scheduler: (task) => task() });
  await assert.rejects(() => unavailable.preflight(operatorRequest({ renderMode: 'FAST' })),
    (error) => error.code === 'FAST_RENDERER_UNAVAILABLE');

  await assert.rejects(() => service.create(operatorRequest(), { preflightId: 'stale' }),
    (error) => error.code === 'PREFLIGHT_STALE');
  const created = await service.create(operatorRequest(), { preflightId: qualityPreflight.preflightId });
  assert.equal(created.status, 'DRAFT'); assert.equal(created.jobStatus, 'QUEUED');
  assert.equal(providerInvocations, 0, 'create must require a separate explicit start');
  const duplicate = await service.create(operatorRequest(), { preflightId: qualityPreflight.preflightId });
  assert.equal(duplicate.productionId, created.productionId, 'double submission must reuse the canonical production');
  await assert.rejects(() => service.start({ productionId: created.productionId, brandId: BRAND_ID, confirmation: false }),
    (error) => error.code === 'START_CONFIRMATION_REQUIRED');
  await assert.rejects(() => service.start({ productionId: created.productionId,
    brandId: '44444444-4444-4444-8444-444444444444', confirmation: true }),
  (error) => error.code === 'PRODUCTION_NOT_FOUND');
  await service.start({ productionId: created.productionId, brandId: BRAND_ID, confirmation: true });
  assert.equal(providerInvocations, 3, 'QUALITY start must route through the existing engine runtime');
  await service.start({ productionId: created.productionId, brandId: BRAND_ID, confirmation: true });
  assert.equal(providerInvocations, 3, 'terminal success must not rerun');

  const fastRequest = operatorRequest({ requestId: OTHER_REQUEST_ID, renderMode: 'FAST', captionsEnabled: true });
  const fastPlan = await service.preflight(fastRequest);
  assert.equal(fastPlan.expectedRendererJobs, 1); assert.equal(fastPlan.expectedProviderCalls, 0);
  const fastCreated = await service.create(fastRequest, { preflightId: fastPlan.preflightId });
  await service.start({ productionId: fastCreated.productionId, brandId: BRAND_ID, confirmation: true });
  assert.equal(providerInvocations, 4, 'FAST start must route through the FAST renderer runtime');

  const retrySource = productions.get(created.productionId);
  retrySource.status = 'RUNNING'; retrySource.jobStatus = 'RETRYING';
  await service.retry({ productionId: created.productionId, brandId: BRAND_ID });
  assert.equal(providerInvocations, 7, 'retry continues the same intended QUALITY execution');
  retrySource.jobStatus = 'RETRYING'; ambiguousExecutions = 1;
  await assert.rejects(() => service.retry({ productionId: created.productionId, brandId: BRAND_ID }),
    (error) => error.code === 'EXECUTION_NEEDS_RECONCILIATION');
  ambiguousExecutions = 0; retrySource.status = 'COMPLETED'; retrySource.jobStatus = 'COMPLETED';

  const priorReviews = structuredClone(reviews);
  await assert.rejects(() => service.regenerate({ productionId: created.productionId, brandId: BRAND_ID,
    requestId: '55555555-5555-4555-8555-555555555555', reason: { unsafe: true } }),
  (error) => error.code === 'V27_INPUT_INVALID');
  const regenerated = await service.regenerate({ productionId: created.productionId, brandId: BRAND_ID,
    requestId: '55555555-5555-4555-8555-555555555555', reason: 'Stronger opening.' });
  assert.notEqual(regenerated.productionId, created.productionId);
  assert.equal(regenerated.requiresExplicitStart, true);
  assert.equal(productions.get(regenerated.productionId).regenerationOf, created.productionId);
  assert.equal(productions.get(regenerated.productionId).jobPayload.canonicalRequest.sceneIdeas,
    'A quiet ambiguous beat;A small attentive gesture');
  assert.equal(productions.get(regenerated.productionId).jobPayload.canonicalRequest.visualDirection,
    'Natural tungsten evening light.');
  assert.equal(productions.get(regenerated.productionId).jobPayload.canonicalRequest.additionalInstructions,
    'Keep performance restrained.\nStronger opening.');
  assert.deepEqual(reviews, priorReviews, 'regeneration must preserve prior master review decisions');
  assert.equal(productions.get(regenerated.productionId).jobStatus, 'QUEUED', 'new output requires its own execution and review');
  const regeneratedAgain = await service.regenerate({ productionId: created.productionId, brandId: BRAND_ID,
    requestId: '55555555-5555-4555-8555-555555555555', reason: 'Stronger opening.' });
  assert.equal(regeneratedAgain.productionId, regenerated.productionId, 'double-click regeneration must be idempotent');
  assert.equal(providerInvocations, 7, 'regenerate must not start or publish');

  const shotRequestId = '66666666-6666-4666-8666-666666666666';
  const shotPlan = await service.preflightShotRegeneration({ productionId: created.productionId,
    brandId: BRAND_ID, shotId: 'operator-shot-1', requestId: shotRequestId, instruction: 'Keep the pause quieter.' });
  assert.equal(shotPlan.expectedVideoGenerations, 1); assert.equal(shotPlan.expectedAudioGenerations, 0);
  assert.equal(shotPlan.expectedProviderCalls, 1); assert.equal(shotPlan.providerCalls, 0);
  assert.equal(providerInvocations, 7, 'shot preflight must make zero provider calls');
  await service.regenerateShot({ productionId: created.productionId, brandId: BRAND_ID,
    shotId: 'operator-shot-1', requestId: shotRequestId, instruction: 'Keep the pause quieter.',
    preflightId: shotPlan.preflightId, confirmation: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerInvocations, 8, 'shot regeneration executes exactly one mocked video provider call');
  const shotRecord = shotRegenerations.get(shotRequestId);
  assert.equal(shotRecord.status, 'SUCCEEDED');
  assert.notEqual(shotRecord.sourceAssetId, shotRecord.replacementAssetId);
  assert.equal(shotRecord.result.publicationTriggered, false);
  assert.deepEqual(reviews, priorReviews, 'shot regeneration preserves prior decisions');
  await service.regenerateShot({ productionId: created.productionId, brandId: BRAND_ID,
    shotId: 'operator-shot-1', requestId: shotRequestId, instruction: 'Keep the pause quieter.',
    preflightId: shotPlan.preflightId, confirmation: true });
  assert.equal(providerInvocations, 8, 'same shot requestId is idempotent');
  shotRecord.status = 'RETRYING';
  await service.regenerateShot({ productionId: created.productionId, brandId: BRAND_ID,
    shotId: 'operator-shot-1', requestId: shotRequestId, instruction: 'Keep the pause quieter.',
    preflightId: shotPlan.preflightId, confirmation: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerInvocations, 8, 'technical retry reuses the same durable replacement asset');
  assert.equal(shotRecord.status, 'SUCCEEDED');

  console.log('V2.7 ProductionCommandService preflight/create/start/retry/regenerate contract passed (mock provider calls only).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
