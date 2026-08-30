'use strict';

const assert = require('node:assert/strict');
const { revisionSafeCanonical } = require('../src/v2.10/integrated-starter');
const { continuationPreflight, continueRecoveredV210 } = require('../apps/dashboard/server/v210-quality-resume');

const productionId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const brandId = '44444444-4444-4444-8444-444444444444';

const shot = (index, role) => ({
  shotId: `shot-${index}`, assetId: `video-${index}`, durationSeconds: 5, roles: [role],
  purpose: role, subject: 'same adult couple in a warm apartment',
  action: index === 1 ? 'notice a quiet emotional shift' : index === 2 ? 'pause and reach gently for a hand' : 'relax after the moment softens',
  environment: 'same warm lived-in apartment living room', emotionalIntent: index === 1 ? 'subtle tension' : 'gentle attention',
  framing: index === 1 ? 'medium wide' : 'medium', camera: 'restrained observational camera',
  lensComposition: 'vertical cinematic naturalism', lighting: 'warm practical lamps and believable skin tones',
  continuity: 'same couple, apartment, wardrobe, props, lighting and camera language',
  negativeGuidance: ['split-screen', 'generated text', 'watermarks', 'extra people', 'melodrama'],
  referencePolicy: 'NONE', voiceoverSegment: index === 2 ? 'Before you assume, notice the moment.' : index === 3 ? "Don't guess. Tune in." : null,
});

const draft = {
  id: draftId, workspace_id: workspaceId, brand_id: brandId, production_id: productionId,
  status: 'STARTED',
  creative_brief: {
    title: 'Attune Creative #2 — Notice the Moment', objective: 'Help couples notice emotional shifts before reacting.',
    targetPlatform: 'Instagram Reels', targetDurationSeconds: 15,
    hook: 'Sometimes distance is not rejection.', coreMessage: 'Before you assume, notice the moment.', cta: "Don't guess. Tune in.",
    audienceIntent: 'Thoughtful couples', creativeConcept: 'Notice before reacting',
    visualStyle: 'Cinematic naturalism, warm apartment, authentic microexpressions.',
    storyboard: [shot(1, 'HOOK'), shot(2, 'INSIGHT'), shot(3, 'CTA')],
    continuity: {
      identity: 'same adult couple', appearance: 'consistent natural appearance', wardrobe: 'same everyday clothing',
      environment: 'same apartment living room', props: 'same sofa and practical lamps',
      lightingColorLanguage: 'warm practical evening light', cameraLanguage: 'restrained observational movement', referencePolicy: 'NONE',
    },
    voice: {
      sourceType: 'AI_PRESET', provider: 'openai', model: 'gpt-4o-mini-tts', voiceId: 'alloy', language: 'en',
      approved: true, approvedConfigurationFingerprint: 'approved-voice', previewArtifact: { artifactId: 'preview-1' },
    },
    postProduction: { endTitle: { enabled: true, text: "Don't guess. Tune in.", startTime: 13, duration: 2 }, brandName: 'Attune' },
  },
};

const authoritativeVideo = {
  provider: 'replicate', providerDisplayName: 'Replicate', providerType: 'API', vendor: 'alibaba',
  modelFamily: 'WAN_3', model: 'alibaba/wan-3', providerModelId: 'alibaba/wan-3', profile: 'STANDARD',
  capability: 'TEXT_TO_VIDEO', capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','AUDIO_DISABLE_SUPPORTED'],
  shotCapabilities: [1,2,3].map((index) => ({ shotId: `shot-${index}`, capability: 'TEXT_TO_VIDEO' })),
  resolvedSettings: { resolution: '720p', framesPerSecond: 24, goFast: false, optimizePrompt: true,
    interpolateOutput: true, sampleShift: 12 }, configurationStatus: 'CONFIGURED', availability: 'READY', costStatus: 'KNOWN',
};
const preflightBase = { authoritativeVideo, quality: { semanticCriticResolved: { provider: 'openai', model: 'gpt-5.6-luna' } } };
const initialCanonical = revisionSafeCanonical({ draft, preflight: preflightBase });
draft.final_preflight = { ...preflightBase, canonicalInputFingerprint: initialCanonical.input.fingerprint };
const canonical = revisionSafeCanonical({ draft, preflight: draft.final_preflight });
assert.equal(canonical.input.fingerprint, draft.final_preflight.canonicalInputFingerprint);

const production = {
  id: productionId, workspaceId, brandId, jobId: '55555555-5555-4555-8555-555555555555', jobStatus: 'RETRYING',
  ambiguousExecutions: 0,
  metadata: { live_input_fingerprint: canonical.input.fingerprint, production_key: canonical.productionKey },
  qualityRecovery: { recovered: true, status: 'READY_TO_CONTINUE' },
};

let scheduled = 0;
let preparedInputs = 0;
const creativeService = {
  repository: { db: { async query() { return { rows: [draft] }; } } },
  starter: {
    runtime(input, live) {
      assert.equal(input.fingerprint, canonical.input.fingerprint, 'resume must use exact persisted V2.10 canonical identity');
      return { config: { live }, env: { LIVE_PAID_GENERATION: live ? 'true' : 'false' }, service: {
        async prepare({ input: preparedInput }) {
          preparedInputs += 1;
          assert.equal(preparedInput.fingerprint, canonical.input.fingerprint);
          return { existing: { productionId, jobStatus: 'RETRYING' }, plan: { expectedQualityEvaluatorCalls: 5 } };
        },
        async run() { throw new Error('scheduled execution must not run inside certification'); },
      } };
    },
    credentialCheck() {},
    scheduler(task) { assert.equal(typeof task, 'function'); scheduled += 1; },
  },
};
const service = {
  repository: {
    async semanticRetryMediaExecutions() {
      return [{ asset_id: 'video-1', kind: 'video', status: 'SUCCEEDED', artifact_storage_key: 'video-1.bin', artifact_content_hash: 'hash-1' }];
    },
  },
  async production(id, scopeBrandId) {
    assert.equal(id, productionId); assert.equal(scopeBrandId, brandId); return production;
  },
};

async function main() {
  const plan = await continuationPreflight({ service, creativeService, productionId, brandId });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.providerCallsDuringPreflight, 0);
  assert.equal(plan.exactCanonicalIdentity, true);
  assert.equal(plan.existingSourceMedia, 1);
  assert.equal(plan.remainingVideoGenerations, 2);
  assert.deepEqual(plan.remainingVideoAssetIds, ['video-2','video-3']);
  assert.equal(plan.remainingSpeechGenerations, 1);
  assert.equal(plan.evaluatorCallsPlanned, 5);

  const accepted = await continueRecoveredV210({ service, creativeService, productionId, brandId, confirmation: true });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.exactCanonicalIdentity, true);
  assert.equal(accepted.existingPaidMediaPreserved, true);
  assert.equal(accepted.videoRegenerationTriggered, false);
  assert.equal(scheduled, 1);
  assert.equal(preparedInputs, 2);

  const badProduction = { ...production, metadata: { ...production.metadata, live_input_fingerprint: 'wrong' } };
  const badService = { ...service, async production() { return badProduction; } };
  await assert.rejects(() => continuationPreflight({ service: badService, creativeService, productionId, brandId }),
    (error) => error.code === 'V210_RESUME_IDENTITY_MISMATCH');

  await assert.rejects(() => continueRecoveredV210({ service, creativeService, productionId, brandId, confirmation: false }),
    (error) => error.code === 'V210_RESUME_CONFIRMATION_REQUIRED');

  console.log('V2.10.1 exact-identity recovered continuation certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
