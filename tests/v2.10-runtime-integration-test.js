'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { CAPABILITIES } = require('../src/v2.8/capabilities');
const {
  V210CanonicalProductionStarter,
  buildCanonicalV210Input,
  canonicalObjective,
  resolveAuthoritativeVideo,
} = require('../src/v2.10/runtime-integration');
const { V210ReferenceAwareMediaExecutor } = require('../src/v2.10/reference-aware-media');

const BRAND_ID = '21000000-0000-4000-8000-000000000011';
const DRAFT_ID = '21000000-0000-4000-8000-000000000099';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function shot(number, roles, referencePolicy = 'NONE') {
  return {
    shotId: `s${number}`,
    assetId: `a${number}`,
    durationSeconds: 5,
    roles,
    purpose: `Advance concrete advertising story beat number ${number}`,
    subject: 'The same attentive adult couple in their warm apartment',
    action: `The couple performs visible restrained action number ${number}`,
    environment: 'Warm apartment living room with green sofa oak table and brass lamps',
    emotionalIntent: 'Quiet authentic attentive connection between the same two adults',
    framing: 'Vertical eye-level medium shot of the same couple',
    camera: 'Restrained slow observational camera movement',
    lensComposition: 'Natural perspective balanced two-person composition with clean negative space',
    lighting: 'Warm amber practical lamps with soft evening contrast',
    continuity: 'Preserve the same faces wardrobe room layout props lighting and camera language',
    negativeGuidance: ['generated text', 'watermarks', 'logos'],
    referencePolicy,
    voiceoverSegment: number === 1 ? 'Notice the moment before assuming.' : 'Choose calm attention today.',
  };
}

function brief(referencePolicy = 'NONE') {
  return {
    title: 'Concrete Attentive Moment Campaign',
    objective: 'Move attentive couples toward a calmer relationship habit',
    targetPlatform: 'Instagram Reels',
    targetDurationSeconds: 10,
    hook: 'A specific moment of hesitation opens the story',
    coreMessage: 'Attention changes an ambiguous relationship moment',
    cta: 'Notice the moment today',
    audienceIntent: 'Help thoughtful couples pause before assuming what silence means',
    creativeConcept: 'A visible progression from tension through attentive action to relief',
    visualStyle: 'Warm restrained cinematic realism with natural micro-expressions and believable movement',
    storyboard: [
      shot(1, ['HOOK', 'TENSION', 'INSIGHT']),
      shot(2, ['ACTION', 'RESOLUTION', 'CTA'], referencePolicy),
    ],
    continuity: {
      identity: 'One consistent adult couple throughout all shots',
      appearance: 'Partner one has short dark curls and partner two has shoulder-length auburn hair',
      wardrobe: 'Blue cotton jacket and cream knit sweater remain unchanged',
      environment: 'Warm apartment with green sofa oak table and two brass lamps',
      props: 'Green sofa oak table ceramic mug and two brass lamps',
      lightingColorLanguage: 'Warm amber practical lights with soft evening contrast',
      cameraLanguage: 'Vertical eye-level restrained observational camera with natural perspective',
      referencePolicy,
    },
    voice: { sourceType: null, approved: false },
    postProduction: { endTitle: { enabled: true, text: 'Notice the moment today', startTime: 8, duration: 2 } },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}

async function main() {
  const catalog = new ProviderCatalog({ env: { REPLICATE_API_TOKEN: 'test-token' } });
  const referencedBrief = brief('PREVIOUS_SHOT_FRAME');

  await assert.rejects(
    () => resolveAuthoritativeVideo({
      catalog,
      workspaceId: 'workspace-1',
      brief: referencedBrief,
      request: {
        provider: 'replicate',
        model: 'wan-video/wan-2.2-t2v-fast',
        profile: 'STANDARD',
        resolution: '720p',
        capability: CAPABILITIES.IMAGE_TO_VIDEO,
        capabilities: [CAPABILITIES.TEXT_TO_VIDEO, CAPABILITIES.IMAGE_TO_VIDEO],
        modelFamily: 'SPOOFED_FAMILY',
      },
    }),
    (error) => error?.code === 'CAPABILITY_UNSUPPORTED',
    'browser-supplied capability/model-family claims must not expand the authoritative catalog',
  );

  const authoritativeVideo = await resolveAuthoritativeVideo({
    catalog,
    workspaceId: 'workspace-1',
    brief: referencedBrief,
    request: { provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD', resolution: '720p' },
  });
  assert.equal(authoritativeVideo.provider, 'replicate');
  assert.equal(authoritativeVideo.model, 'alibaba/wan-3');
  assert.deepEqual(authoritativeVideo.shotCapabilities, [
    { shotId: 's1', capability: CAPABILITIES.TEXT_TO_VIDEO },
    { shotId: 's2', capability: CAPABILITIES.IMAGE_TO_VIDEO },
  ]);

  assert.equal(canonicalObjective('ORGANIC REACH'), 'ORGANIC_REACH');
  assert.equal(canonicalObjective(referencedBrief.objective), 'EXPERIMENT');
  const preflight = {
    authoritativeVideo,
    quality: { semanticCriticResolved: { provider: 'openai', model: 'mock-semantic' } },
  };
  const draft = { id: DRAFT_ID, brand_id: BRAND_ID, workspace_id: 'workspace-1', creative_brief: referencedBrief };
  const canonical = buildCanonicalV210Input({ draft, preflight });
  assert.equal(canonical.input.objective, 'EXPERIMENT', 'free-form V2.10 objective must cross the V2.5 enum boundary safely');
  assert.equal(canonical.input.creativePlan.creativeObjective, referencedBrief.objective, 'human creative objective remains preserved');
  assert.equal(canonical.canonicalRequest.creativeObjective, referencedBrief.objective);
  const secondAsset = canonical.input.assetPlan.assets.find((asset) => asset.asset_id === 'a2');
  assert.equal(secondAsset.generation_requirements.capability, CAPABILITIES.IMAGE_TO_VIDEO);
  assert.deepEqual(secondAsset.generation_requirements.v210_reference, {
    policy: 'PREVIOUS_SHOT_FRAME', previousAssetId: 'a1',
  });

  let preparedInput = null;
  const configResolver = (env, input) => ({
    live: env.LIVE_PAID_GENERATION === 'true',
    renderMode: 'QUALITY',
    provider: input.qualityVideoProfile.provider,
    model: input.qualityVideoProfile.model,
    adapterFamily: input.qualityVideoProfile.adapterFamily,
    audioProvider: 'none',
    audioModel: null,
    workerId: 'v210-runtime-test',
    storageRoot: '/tmp/v210-runtime-test',
  });
  const dryStarter = new V210CanonicalProductionStarter({
    db: {}, storage: {}, repository: {}, env: { LIVE_PAID_GENERATION: 'false' }, configResolver,
    runtimeFactory: () => ({ service: { async prepare({ input }) {
      preparedInput = input;
      return { plan: { readiness: 'READY', expectedVideoGenerations: 2, expectedAudioGenerations: 0 } };
    } } }),
  });
  const canonicalPreflight = await dryStarter.preflight({ draft, preflight });
  assert.equal(canonicalPreflight.providerExecutions, 0);
  assert.equal(canonicalPreflight.canonicalInputFingerprint, canonical.input.fingerprint);
  assert.equal(preparedInput.fingerprint, canonical.input.fingerprint, 'starter must prepare the exact canonical input');

  let scheduled = null;
  let createDraftCalls = 0;
  const liveStarter = new V210CanonicalProductionStarter({
    db: {}, storage: {}, repository: {}, env: { LIVE_PAID_GENERATION: 'true' }, configResolver,
    credentialCheck: () => {},
    scheduler: (task) => { scheduled = task; },
    runtimeFactory: () => ({ service: {
      async createDraft({ input }) {
        createDraftCalls += 1;
        assert.equal(input.fingerprint, canonical.input.fingerprint);
        return { production: { id: 'production-1' }, job: { id: 'job-1' } };
      },
      async run() { throw new Error('scheduler must not execute provider work inside this integration test'); },
    } }),
  });
  const started = await liveStarter.start({ draft, preflight, actor: 'runtime-test' });
  assert.equal(started.productionId, 'production-1');
  assert.equal(started.boundaryState, 'CANONICAL_CREATED');
  assert.equal(createDraftCalls, 1);
  assert.equal(typeof scheduled, 'function', 'provider execution is scheduled only after canonical draft creation');

  const previousBytes = Buffer.from('immutable-previous-video');
  const previousHash = sha256(previousBytes);
  const frameBytes = Buffer.from('immutable-reference-frame');
  const row = {
    status: 'SUCCEEDED', artifact_storage_key: 'media/a1', artifact_content_hash: previousHash,
    content_type: 'video/mp4', duration_ms: 5000,
    media_probe: { durationMs: 5000, width: 720, height: 1280 },
  };
  const delegate = {
    repository: { async get({ assetId }) { assert.equal(assetId, 'a1'); return row; } },
    artifactService: {}, mediaInspector: {}, assetRepository: {},
    selection() { throw new Error('selection is not used during reference materialization'); },
    identities() { throw new Error('identities are not used during reference materialization'); },
  };
  const referenceExecutor = new V210ReferenceAwareMediaExecutor({
    delegate,
    storage: { async get({ key }) { assert.equal(key, 'media/a1'); return previousBytes; } },
    frameSampler: { async sample({ bytes }) {
      assert.equal(sha256(bytes), previousHash);
      return [{ jpeg: frameBytes, timestampMs: 4900, analysisHash: 'analysis-frame-1' }];
    } },
  });
  const materialized = await referenceExecutor.materializeAsset({
    workspaceId: 'workspace-1', brandId: BRAND_ID, productionId: 'production-1', asset: secondAsset,
  });
  assert.match(materialized.generation_requirements.references.first_frame, /^data:image\/jpeg;base64,/);
  assert.equal(materialized.generation_requirements.v210_reference_evidence.previousAssetId, 'a1');
  assert.equal(materialized.generation_requirements.v210_reference_evidence.sourceArtifactContentHash, previousHash);
  assert.equal(materialized.generation_requirements.v210_reference_evidence.referenceHash, sha256(frameBytes));

  const corruptExecutor = new V210ReferenceAwareMediaExecutor({
    delegate,
    storage: { async get() { return Buffer.from('mutated-bytes'); } },
    frameSampler: { async sample() { throw new Error('must not sample corrupt evidence'); } },
  });
  await assert.rejects(
    () => corruptExecutor.materializeAsset({
      workspaceId: 'workspace-1', brandId: BRAND_ID, productionId: 'production-1', asset: secondAsset,
    }),
    (error) => error?.code === 'REFERENCE_EVIDENCE_HASH_MISMATCH',
    'reference materialization must fail before provider execution when immutable evidence hash changes',
  );

  console.log('V2.10 runtime integration passed: catalog authoritative, spoofing blocked, canonical starter verified, reference evidence materialized; real external calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
