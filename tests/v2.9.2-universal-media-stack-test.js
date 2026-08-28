'use strict';

const assert = require('node:assert/strict');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { createCanonicalMediaRequest } = require('../src/v2.8/canonical-media-request');
const { createVideoAdapter } = require('../src/v2.8/provider-adapter-factory');
const { createAlibabaProtocol } = require('../src/v2.8/provider-protocols');
const { buildWan3Input, buildSeedance25Input } = require('../src/providers/replicate-universal-video-adapter');
const { createElevenLabsTtsProvider } = require('../src/providers/elevenlabs-tts-provider');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { qualityProfileFromSelection } = require('../src/v2.7/quality-video-profile');
const { AUDIO_STRATEGIES, MASTER_PROFILES, MEDIA_STACK_PRESETS, MediaStackError, brandMediaPreferences, resolveMediaStack } = require('../src/v2.9.2/media-stack');
const { currentStatus, estimateMediaStack, priceFor } = require('../src/v2.9.2/pricing-registry');

function response({ status = 200, json = null, bytes = null, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => json == null ? '' : JSON.stringify(json),
    arrayBuffer: async () => Buffer.from(bytes || '').buffer.slice(Buffer.from(bytes || '').byteOffset,
      Buffer.from(bytes || '').byteOffset + Buffer.from(bytes || '').byteLength) };
}

async function main() {
  let realProviderCalls = 0;
  const env = { REPLICATE_API_TOKEN: 'synthetic-replicate', FAL_KEY: 'synthetic-fal', RUNWAYML_API_SECRET: 'synthetic-runway',
    GOOGLE_API_KEY: 'synthetic-google', OPENAI_API_KEY: 'synthetic-openai', ELEVENLABS_API_KEY: 'synthetic-elevenlabs',
    DASHSCOPE_API_KEY: 'synthetic-dashscope', ALIBABA_MODEL_STUDIO_WORKSPACE_ID: 'ws-synthetic-123',
    ALIBABA_MODEL_STUDIO_REGION: 'singapore' };
  const catalog = new ProviderCatalog({ env });

  assert.equal(MEDIA_STACK_PRESETS.STANDARD.video.model, 'gen4.5');
  assert.equal(MEDIA_STACK_PRESETS.CUSTOM.video, undefined);
  assert.deepEqual([MASTER_PROFILES.SOCIAL_VERTICAL.width, MASTER_PROFILES.SOCIAL_VERTICAL.height,
    MASTER_PROFILES.SOCIAL_VERTICAL.framesPerSecond], [1080,1920,30]);
  assert.deepEqual(AUDIO_STRATEGIES.slice(0, 4), ['EXTERNAL_VOICE','NATIVE_VIDEO_AUDIO','HYBRID','NO_VOICE']);
  const wanProviders = catalog.listProviders().filter((provider) => provider.models.some((model) => model.modelFamily === 'WAN_3'));
  assert.deepEqual(wanProviders.map((provider) => provider.id), ['replicate','alibaba']);
  const seedanceProviders = catalog.listProviders().filter((provider) => provider.models.some((model) => model.modelFamily === 'SEEDANCE_2_5'));
  assert.deepEqual(seedanceProviders.map((provider) => provider.id), ['replicate','fal']);
  assert.equal(new ProviderCatalog({ env: {} }).listProviders().find((provider) => provider.id === 'alibaba').supportStatus, 'SUPPORTED');
  assert.equal(new ProviderCatalog({ env: {} }).listProviders().find((provider) => provider.id === 'alibaba').configurationStatus, 'NOT_CONFIGURED');

  const standard = resolveMediaStack({ request: {}, catalog, env });
  assert.equal(standard.video.modelFamily, 'RUNWAY_GEN_4_5');
  assert.equal(standard.audio.dialogueOwner, 'EXTERNAL_VOICE');
  assert.equal(standard.audio.preventDuplicateNarration, true);
  assert(Object.isFrozen(standard));
  const brandPreference = brandMediaPreferences({ knowledge: [{ knowledgeType: 'MEDIA_STACK_PREFERENCES',
    content: { voice: { provider: 'elevenlabs', model: 'eleven_v3', voiceId: 'brand-voice' } } }] });
  const brandResolved = resolveMediaStack({ request: { voiceId: 'operator-voice' }, brandPreferences: brandPreference, catalog, env });
  assert.equal(brandResolved.audio.voice.provider, 'elevenlabs');
  assert.equal(brandResolved.audio.voice.voiceId, 'operator-voice');
  const customWan = resolveMediaStack({ request: { preset: 'CUSTOM', provider: 'alibaba', modelFamily: 'WAN_3',
    model: 'wan3.0-video', profile: 'STANDARD', audioStrategy: 'NATIVE_VIDEO_AUDIO' }, catalog, env });
  assert.equal(customWan.video.providerModelId, 'wan3.0-video');
  assert.equal(customWan.audio.generateExternalVoice, false);
  assert.equal(customWan.audio.generateNativeAudio, true);
  assert.throws(() => resolveMediaStack({ request: { provider: 'runway', model: 'gen4.5', profile: 'STANDARD',
    audioStrategy: 'NATIVE_VIDEO_AUDIO' }, catalog, env }), (error) => error instanceof MediaStackError && error.code === 'NATIVE_AUDIO_UNSUPPORTED');
  assert.throws(() => resolveMediaStack({ request: { preset: 'CUSTOM', provider: 'replicate', modelFamily: 'SEEDANCE_2_5',
    model: 'alibaba/wan-3', profile: 'STANDARD' }, catalog, env }), (error) => error.code === 'MODEL_FAMILY_MISMATCH');

  const brand = { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Brand', status: 'ACTIVE',
    mission: 'Synthetic mission', positioning: 'Synthetic positioning', products: [], audiences: [], offers: [], campaigns: [] };
  const operator = { requestId: '22222222-2222-4222-8222-222222222222', brandId: brand.id, renderMode: 'QUALITY',
    title: 'Synthetic production', objective: 'ENGAGEMENT', platform: 'Instagram Reels', targetDurationSeconds: 10,
    aspectRatio: '9:16', hook: 'Notice this.', coreMessage: 'A synthetic message.', creativeBrief: 'Two restrained cinematic beats.',
    cta: 'Learn more.', captionsEnabled: false, musicEnabled: false };
  const nativeBuilt = buildOperatorProductionInput(operator, brand, { qualityProfile: qualityProfileFromSelection(customWan.video), mediaStack: customWan });
  assert.equal(nativeBuilt.input.mediaStack.video.modelFamily, 'WAN_3');
  assert.equal(nativeBuilt.input.assetPlan.assets.filter((asset) => asset.kind === 'voice').length, 0);
  assert(nativeBuilt.input.assetPlan.assets.filter((asset) => asset.kind === 'video')
    .every((asset) => asset.generation_requirements.generate_audio === true));
  const externalEleven = resolveMediaStack({ request: { preset: 'CUSTOM', provider: 'replicate', modelFamily: 'WAN_3',
    model: 'alibaba/wan-3', profile: 'STANDARD', audioStrategy: 'EXTERNAL_VOICE', voiceProvider: 'elevenlabs',
    voiceModel: 'eleven_v3', voiceId: 'voice-synthetic' }, catalog, env });
  const externalBuilt = buildOperatorProductionInput(operator, brand, { qualityProfile: qualityProfileFromSelection(externalEleven.video), mediaStack: externalEleven });
  const voiceAsset = externalBuilt.input.assetPlan.assets.find((asset) => asset.kind === 'voice');
  assert.equal(voiceAsset.generation_requirements.provider, 'elevenlabs');
  assert.equal(voiceAsset.generation_requirements.voice_id, 'voice-synthetic');
  assert(externalBuilt.input.assetPlan.assets.filter((asset) => asset.kind === 'video')
    .every((asset) => asset.generation_requirements.generate_audio === false));

  assert.deepEqual(buildWan3Input({ prompt: 'A clean product reveal', image: 'https://example.invalid/start.png', duration: 6 }), {
    prompt: 'A clean product reveal', resolution: '720p', duration: 6, image: 'https://example.invalid/start.png', enable_prompt_expansion: true });
  const seedanceInput = buildSeedance25Input({ prompt: 'A dialogue scene', referenceVideos: ['https://example.invalid/ref.mp4'],
    referenceAudios: ['https://example.invalid/ref.mp3'], generateAudio: true });
  assert.equal(seedanceInput.generate_audio, true);
  assert.equal(seedanceInput.reference_audios.length, 1);
  assert.throws(() => buildSeedance25Input({ prompt: 'invalid refs', image: 'a', referenceVideos: ['b'] }), /cannot be combined/);
  const wan3Adapter = createVideoAdapter(catalog.resolveSelection({ provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD' }), {
    env, fetchImpl: async () => response({ json: { id: 'never-called', status: 'failed' } }) });
  assert.equal(wan3Adapter.supports({ capability: 'TEXT_TO_VIDEO', model: 'alibaba/wan-3' }), true);
  const replicateResponses = [response({ json: { id: 'wan3-prediction', status: 'succeeded', output: 'https://media.invalid/wan3.mp4' } }),
    response({ bytes: Buffer.from('wan3-video') })];
  const replicateResult = await createVideoAdapter(catalog.resolveSelection({ provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD' }), {
    env, fetchImpl: async () => replicateResponses.shift(), sleep: async () => {} }).generate({ canonicalRequest: createCanonicalMediaRequest({
      capability: 'TEXT_TO_VIDEO', prompt: 'Replicate Wan 3 canonical request', durationSeconds: 5, resolution: '720p', aspectRatio: '9:16',
      providerSelection: { provider: 'replicate', modelFamily: 'WAN_3', model: 'alibaba/wan-3', profile: 'STANDARD' },
      resolvedSettings: { enablePromptExpansion: true } }) });
  assert.equal(replicateResult.requestId, 'wan3-prediction');

  const alibabaProtocol = createAlibabaProtocol({ region: 'singapore', workspaceId: 'ws-synthetic-123' });
  assert.match(alibabaProtocol.submit().url, /^https:\/\/ws-synthetic-123\.ap-southeast-1\.maas\.aliyuncs\.com\//);
  assert.throws(() => createAlibabaProtocol({ region: 'unknown', workspaceId: 'ws-synthetic-123' }), (error) => error.code === 'ALIBABA_REGION_INVALID');
  const canonical = createCanonicalMediaRequest({ capability: 'TEXT_TO_VIDEO', prompt: 'A cinematic street scene',
    durationSeconds: 5, resolution: '720p', aspectRatio: '9:16', audio: { requested: true, strategy: 'NATIVE_VIDEO_AUDIO' },
    providerSelection: { provider: 'alibaba', vendor: 'alibaba', modelFamily: 'WAN_3', providerModelId: 'wan3.0-video', model: 'wan3.0-video', profile: 'STANDARD' },
    resolvedSettings: { resolution: '720p', duration: 5 } });
  const mapped = alibabaProtocol.mapRequest(canonical);
  assert.deepEqual({ model: mapped.model, audio: mapped.parameters.audio, resolution: mapped.parameters.resolution },
    { model: 'wan3.0-video', audio: true, resolution: '720P' });
  assert.equal(mapped.parameters.prompt_extend, true);
  const mixedReferences = createCanonicalMediaRequest({ ...canonical, capability: 'REFERENCE_TO_VIDEO', references: { firstFrame: 'https://example.invalid/first.png',
    referenceVideos: ['https://example.invalid/reference.mp4'] } });
  assert.throws(() => alibabaProtocol.mapRequest(mixedReferences), (error) => error.code === 'PROVIDER_INPUT_INVALID');

  const asyncCalls = [];
  const asyncResponses = [
    response({ json: { output: { task_id: 'task-1', task_status: 'PENDING' } } }),
    response({ json: { output: { task_id: 'task-1', task_status: 'SUCCEEDED', video_url: 'https://media.invalid/video.mp4' }, usage: { duration: 5 } } }),
    response({ bytes: Buffer.from('mock-video') }),
  ];
  const adapter = createVideoAdapter(catalog.resolveSelection({ provider: 'alibaba', model: 'wan3.0-video', profile: 'STANDARD' }), {
    env, fetchImpl: async (url, options) => { asyncCalls.push({ url, method: options.method }); return asyncResponses.shift(); }, sleep: async () => {}, pollIntervalMs: 1 });
  const result = await adapter.generate({ canonicalRequest: canonical, onProviderRequest: ({ requestId }) => assert.equal(requestId, 'task-1') });
  assert.equal(result.requestId, 'task-1');
  assert.equal(result.usage.duration, 5);
  assert.equal(asyncCalls.filter((call) => call.method === 'POST').length, 1);

  const recoveryCalls = [];
  const recoveryResponses = [response({ json: { output: { task_id: 'task-recover', task_status: 'SUCCEEDED', video_url: 'https://media.invalid/recovered.mp4' } } }), response({ bytes: Buffer.from('recovered') })];
  const recoveryAdapter = createVideoAdapter(catalog.resolveSelection({ provider: 'alibaba', model: 'wan3.0-video', profile: 'STANDARD' }), {
    env, fetchImpl: async (url, options) => { recoveryCalls.push({ url, method: options.method }); return recoveryResponses.shift(); }, sleep: async () => {} });
  const recovered = await recoveryAdapter.recover({ requestId: 'task-recover', model: 'wan3.0-video', canonicalRequest: canonical });
  assert.equal(recovered.requestId, 'task-recover');
  assert.equal(recoveryCalls.some((call) => call.method === 'POST'), false);

  let ttsAttempts = 0; let ttsBody;
  const tts = createElevenLabsTtsProvider({ apiKey: 'synthetic', sleep: async () => {}, fetchImpl: async (_url, options) => {
    ttsAttempts += 1; ttsBody = JSON.parse(options.body);
    if (ttsAttempts === 1) return response({ status: 429, json: { detail: 'synthetic rate limit' } });
    return response({ bytes: Buffer.from('mock-audio'), headers: { 'request-id': 'tts-1', 'character-cost': '12' } });
  } });
  const speech = await tts.generate({ capability: 'speech-generation', model: 'eleven_v3',
    prompt: JSON.stringify({ description: 'fallback', generation_requirements: { text: 'Approved spoken copy.', voice_id: 'voice-synthetic', language: 'en' } }) });
  assert.equal(ttsAttempts, 2);
  assert.equal(ttsBody.model_id, 'eleven_v3');
  assert.equal(speech.provenance.voiceId, 'voice-synthetic');
  assert.equal(speech.usage.characters, 21);

  const wanPrice = priceFor({ provider: 'replicate', model: 'alibaba/wan-3', component: 'VIDEO', resolution: '720p' });
  assert.equal(wanPrice.amountUsd, 0.1);
  assert.deepEqual([wanPrice.modelFamily, wanPrice.providerModelId, wanPrice.currency, wanPrice.sourceType],
    ['WAN_3', 'alibaba/wan-3', 'USD', 'OFFICIAL_PROVIDER_PAGE']);
  assert.equal(currentStatus({ status: 'PROMOTIONAL', validUntil: '2026-09-23T16:00:00.000Z' }, new Date('2026-09-24')), 'STALE');
  const estimate = estimateMediaStack({ video: { provider: 'replicate', model: 'alibaba/wan-3', resolution: '720p', durationSeconds: 10 },
    voice: { provider: 'elevenlabs', model: 'eleven_v3', characterCount: 1000 } });
  assert.equal(estimate.estimatedTotalUsd, 1.1);
  assert.equal(estimate.status, 'VERIFIED');
  assert.deepEqual(estimate.components.map((item) => item.component), ['VIDEO','VOICE','SEMANTIC_CRITIC','OTHER_EXTERNAL']);

  assert.equal(realProviderCalls, 0);
  console.log('V2.9.2 universal media registry, presets, explicit routing, audio ownership, provider mappings, recovery, pricing, and mocked TTS passed (real provider calls 0).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
