'use strict';

const assert = require('node:assert/strict');
const { ProviderCatalog, ProviderCatalogError } = require('../src/v2.8/provider-catalog');
const { createCanonicalMediaRequest, CanonicalMediaRequestError } = require('../src/v2.8/canonical-media-request');
const { AsyncMediaProviderAdapter } = require('../src/v2.8/async-media-provider-adapter');
const { PROTOCOLS } = require('../src/v2.8/provider-protocols');
const { createVideoAdapter } = require('../src/v2.8/provider-adapter-factory');
const { assertUniversalAdapter } = require('../src/v2.8/provider-adapter-contract');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { qualityProfileFromSelection } = require('../src/v2.7/quality-video-profile');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { ProductionCommandService } = require('../src/v2.7/production-command-service');

function json(body, status = 200) { return { ok: status >= 200 && status < 300, status,
  async text() { return JSON.stringify(body); }, async arrayBuffer() { return Buffer.from('mock-video'); } }; }

function request(provider, model, profile = 'STANDARD', overrides = {}) {
  return createCanonicalMediaRequest({ capability: 'TEXT_TO_VIDEO', prompt: 'A quiet human moment', durationSeconds: provider === 'google' ? 8 : 5,
    aspectRatio: '9:16', resolution: '720p', providerSelection: { provider, vendor: provider, model, profile }, ...overrides });
}

async function adapterContract(provider, model, responses) {
  const calls = [];
  const adapter = new AsyncMediaProviderAdapter({ protocol: PROTOCOLS[provider], credential: 'synthetic-test-key',
    pollIntervalMs: 1, timeoutMs: 100, sleep: async () => {}, fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
        authorizationPresent: Boolean(options.headers?.Authorization || options.headers?.['x-goog-api-key']) });
      if (/\.(mp4|test)$/.test(url)) return { ok: true, status: 200, async arrayBuffer() { return Buffer.from('mock-video'); } };
      const next = responses.shift(); assert.ok(next, `Unexpected ${provider} request ${url}`); return json(next.body, next.status);
    } });
  assert.equal(assertUniversalAdapter(adapter), adapter);
  let boundary = null;
  const result = await adapter.generate({ canonicalRequest: request(provider, model, provider === 'google' ? 'PREMIUM' : 'STANDARD'),
    model, onProviderRequest: async (entry) => { boundary = entry; } });
  assert.equal(boundary.status, 'submitted'); assert.ok(boundary.requestId);
  assert.equal(result.provider, provider); assert.equal(result.model, model); assert.equal(result.output.toString(), 'mock-video');
  assert.ok(calls.every((call) => call.authorizationPresent || /\.(mp4|test)$/.test(call.url)), `${provider} authenticates API calls`);
  return calls;
}

async function main() {
  const env = { REPLICATE_API_TOKEN: 'x', FAL_KEY: 'x', RUNWAYML_API_SECRET: 'x', GOOGLE_API_KEY: 'x', LUMA_API_KEY: 'x',
    OPENAI_API_KEY: 'x', MPT_ENABLED: 'true', MPT_BASE_URL: 'http://127.0.0.1:8080', MPT_AUTO_PUBLISH_DISABLED: 'true' };
  const catalog = new ProviderCatalog({ env });
  assert.deepEqual(catalog.listProviders().map((item) => item.id), ['replicate','fal','runway','google','luma','openai','moneyprinterturbo']);
  for (const provider of catalog.listProviders()) {
    assert.equal(provider.configured, true); assert.notEqual(provider.availability, 'READY', 'credential presence is not a live probe');
    assert.equal(Object.hasOwn(provider, 'credential'), false); assert.equal(JSON.stringify(provider).includes('synthetic-test-key'), false);
  }
  const matrix = [
    ['replicate','wan-video/wan-2.2-t2v-fast','STANDARD','TEXT_TO_VIDEO'],
    ['fal','bytedance/seedance-2.0/text-to-video','STANDARD','TEXT_TO_VIDEO'],
    ['runway','gen4.5','STANDARD','TEXT_TO_VIDEO'],
    ['google','veo-3.1-generate-preview','PREMIUM','TEXT_TO_VIDEO'],
    ['luma','ray-2','STANDARD','TEXT_TO_VIDEO'],
    ['moneyprinterturbo','v1.3.3','ECONOMY','FAST_RENDER'],
  ];
  for (const [provider, model, profile, capability] of matrix) {
    const resolved = catalog.resolveSelection({ provider, model, profile, capability, aspectRatio: '9:16' });
    assert.equal(resolved.provider, provider); assert.equal(resolved.model, model); assert.equal(resolved.profile, profile);
  }
  assert.throws(() => new ProviderCatalog({ env: {} }).resolveSelection({ provider: 'fal', model: 'bytedance/seedance-2.0/text-to-video', profile: 'STANDARD' }),
    (error) => error instanceof ProviderCatalogError && error.code === 'CREDENTIALS_MISSING');
  assert.throws(() => catalog.resolveSelection({ provider: 'auto', model: 'x', profile: 'STANDARD' }), (error) => error.code === 'SELECTED_PROVIDER_UNAVAILABLE');
  assert.throws(() => catalog.resolveSelection({ provider: 'fal', model: 'missing', profile: 'STANDARD' }), (error) => error.code === 'SELECTED_MODEL_UNAVAILABLE');
  assert.throws(() => catalog.resolveSelection({ provider: 'runway', model: 'gen4.5', profile: 'PREMIUM' }), (error) => error.code === 'SELECTED_PROFILE_UNAVAILABLE');
  assert.throws(() => catalog.resolveSelection({ provider: 'runway', model: 'gen4.5', profile: 'STANDARD', capability: 'REFERENCE_TO_VIDEO' }), (error) => error.code === 'CAPABILITY_UNSUPPORTED');
  assert.throws(() => catalog.resolveSelection({ provider: 'runway', model: 'gen4.5', profile: 'STANDARD', durationSeconds: 8 }), (error) => error.code === 'UNSUPPORTED_DURATION');
  assert.throws(() => catalog.resolveSelection({ provider: 'runway', model: 'gen4.5', profile: 'STANDARD', resolution: '1080p' }), (error) => error.code === 'UNSUPPORTED_RESOLUTION');
  assert.throws(() => catalog.resolveSelection({ provider: 'runway', model: 'gen4.5', profile: 'STANDARD', aspectRatio: '1:1' }), (error) => error.code === 'UNSUPPORTED_ASPECT_RATIO');
  assert.throws(() => catalog.resolveSelection({ provider: 'replicate', model: 'bytedance/seedance-1-pro', profile: 'STANDARD' }), (error) => error.code === 'SELECTED_MODEL_UNAVAILABLE');
  assert.throws(() => request('runway','gen4.5','STANDARD', { references: { firstFrame: 'https://example.test/frame.png' } }),
    (error) => error instanceof CanonicalMediaRequestError && error.code === 'CAPABILITY_UNSUPPORTED');

  const falCalls = await adapterContract('fal', 'bytedance/seedance-2.0/text-to-video', [
    { body: { request_id: 'fal-1', status_url: 'unused' } }, { body: { status: 'COMPLETED' } },
    { body: { video: { url: 'https://media.test/fal.mp4' }, seed: 1 } },
  ]);
  assert.equal(falCalls[0].body.prompt, 'A quiet human moment'); assert.equal(falCalls[0].body.aspect_ratio, '9:16');
  await adapterContract('runway', 'gen4.5', [{ body: { id: 'runway-1' } }, { body: { id: 'runway-1', status: 'SUCCEEDED', output: ['https://media.test/runway.mp4'] } }]);
  await adapterContract('google', 'veo-3.1-generate-preview', [{ body: { name: 'operations/google-1' } }, { body: { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://media.test/google.mp4' } }] } } } }]);
  await adapterContract('luma', 'ray-2', [{ body: { id: 'luma-1', state: 'queued' } }, { body: { id: 'luma-1', state: 'completed', assets: { video: 'https://media.test/luma.mp4' } } }]);

  const timeout = new AsyncMediaProviderAdapter({ protocol: PROTOCOLS.runway, credential: 'x', pollIntervalMs: 1,
    timeoutMs: 1, sleep: async () => {}, now: (() => { let value = 0; return () => value += 2; })(),
    fetchImpl: async () => json({ id: 'timeout-task' }) });
  await assert.rejects(() => timeout.generate({ canonicalRequest: request('runway','gen4.5') }), (error) => error.code === 'PROVIDER_TIMEOUT');
  const failed = new AsyncMediaProviderAdapter({ protocol: PROTOCOLS.runway, credential: 'x', pollIntervalMs: 1,
    timeoutMs: 20, sleep: async () => {}, fetchImpl: async (_url, options = {}) => json(options.method === 'POST' ? { id: 'failed-task' } : { id: 'failed-task', status: 'FAILED' }) });
  await assert.rejects(() => failed.generate({ canonicalRequest: request('runway','gen4.5') }), (error) => error.code === 'PROVIDER_FAILED');

  const invoked = [];
  const fake = (provider, model) => ({ supports: () => true, modelFor: () => model, async generate() { invoked.push(provider); return { provider, model, output: Buffer.from('x'), contentType: 'video/mp4' }; } });
  const gateway = new ProviderGateway({ providers: Object.fromEntries(matrix.slice(0, 5).map(([provider, model]) => [provider, fake(provider, model)])), routing: { fallbackOnError: false } });
  for (const [provider, model] of matrix.slice(0, 5)) await gateway.generate({ capability: 'video-generation', provider, model, prompt: 'mock' });
  assert.deepEqual(invoked, matrix.slice(0, 5).map(([provider]) => provider), 'explicit route reaches only the selected provider');

  const replicate = createVideoAdapter(catalog.resolveSelection({ provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast', profile: 'STANDARD' }), { env, fetchImpl: async () => json({}) });
  assert.equal(replicate.constructor.name, 'ReplicateWanVideoAdapter');
  const declarativeFal = createVideoAdapter({ provider: 'fal', model: 'compatible/new-video', adapterFamily: 'fal-video' }, { env, fetchImpl: async () => json({}) });
  assert.equal(declarativeFal.supports({ capability: 'TEXT_TO_VIDEO', model: 'compatible/new-video' }), true,
    'a compatible fal queue model uses the existing isolated adapter without production-engine changes');

  const brand = { id: '11111111-1111-4111-8111-111111111111', name: 'Attune', mission: 'Understanding' };
  const selection = catalog.resolveSelection({ provider: 'fal', model: 'bytedance/seedance-2.0/text-to-video', profile: 'STANDARD' });
  const built = buildOperatorProductionInput({ requestId: '22222222-2222-4222-8222-222222222222', brandId: brand.id,
    renderMode: 'QUALITY', title: 'Universal route', objective: 'ENGAGEMENT', platform: 'Reels', targetDurationSeconds: 10,
    aspectRatio: '9:16', hook: 'Notice', coreMessage: 'Tune in', creativeBrief: 'Two five second human scenes', cta: 'Attune' },
  brand, { qualityProfile: qualityProfileFromSelection(selection) });
  assert.deepEqual(built.canonicalRawInput.provider_selection, { provider: 'fal', vendor: 'bytedance',
    model: 'bytedance/seedance-2.0/text-to-video', model_version: null, profile: 'STANDARD', capability: 'TEXT_TO_VIDEO',
    resolved_settings: selection.resolvedSettings });
  assert.ok(built.input.assetPlan.assets.filter((asset) => asset.kind === 'video').every((asset) =>
    asset.generation_requirements.provider_selection.provider === 'fal'));

  let preparedCalls = 0;
  const command = new ProductionCommandService({ repository: { db: {}, async getBrand() { return { ...brand, workspaceId: '33333333-3333-4333-8333-333333333333', status: 'ACTIVE' }; } },
    storage: {}, env: { ...env, LIVE_PAID_GENERATION: 'false' }, providerCatalog: catalog,
    configResolver: (_env, input) => ({ live: false, renderMode: input.renderMode, provider: input.qualityVideoProfile.provider,
      model: input.qualityVideoProfile.model, adapterFamily: input.qualityVideoProfile.adapterFamily,
      audioProvider: 'openai-media', audioModel: 'gpt-4o-mini-tts', workerId: 'v2.8-test', storageRoot: '/tmp' }),
    runtimeFactory: ({ config }) => ({ config, service: { async prepare({ input }) { preparedCalls += 1;
      assert.equal(config.provider, 'fal'); assert.equal(config.adapterFamily, 'fal-video');
      return { input: Object.freeze({ ...input, workspaceId: '33333333-3333-4333-8333-333333333333' }), plan: {
        brand: 'Attune', renderMode: 'QUALITY', renderer: 'v2.5-quality', provider: config.provider, model: config.model,
        targetDurationSeconds: 10, aspectRatio: '9:16', expectedVideoGenerations: 2, expectedAudioGenerations: 1,
        expectedPaidProviderCalls: 3, expectedExternalServiceCalls: 3, dryRunProviderCalls: 0, providerExecutions: 0,
        dryRunRendererExecutions: 0, rendererAvailability: { availability: 'READY' }, schemaCompatibility: 'READY',
        publicationPolicy: { requiresHumanApproval: true }, costStatus: 'UNKNOWN' } }; } } }) });
  const preflight = await command.preflight({ requestId: '22222222-2222-4222-8222-222222222222', brandId: brand.id,
    renderMode: 'QUALITY', provider: 'fal', model: 'bytedance/seedance-2.0/text-to-video', profile: 'STANDARD',
    title: 'Universal route', objective: 'ENGAGEMENT', platform: 'Reels', targetDurationSeconds: 10, aspectRatio: '9:16',
    hook: 'Notice', coreMessage: 'Tune in', creativeBrief: 'Two five second human scenes', cta: 'Attune' });
  assert.equal(preparedCalls, 1); assert.equal(preflight.provider, 'fal'); assert.equal(preflight.vendor, 'bytedance');
  assert.equal(preflight.profile, 'STANDARD'); assert.equal(preflight.capability, 'TEXT_TO_VIDEO');
  assert.equal(preflight.expectedVideoGenerations, 2); assert.equal(preflight.expectedAudioGenerations, 1);
  assert.equal(preflight.expectedExternalExecutions, 3); assert.equal(preflight.preflightProviderExecutions, 0);
  console.log('V2.8 universal provider catalog, resolver, canonical contract, adapters, routing, and provenance passed (provider calls 0).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
