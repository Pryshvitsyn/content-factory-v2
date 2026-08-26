'use strict';

const assert = require('node:assert/strict');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { resolveQualityVideoProfile } = require('../src/v2.7/quality-video-profile');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { progressFor } = require('../apps/dashboard/server/control-service');
const {
  MasterProductionOrchestrator,
  buildMasterTimeline,
  validatePostRenderQuality,
  validatePreExecutionQuality,
} = require('../worker/v2.1-master-production');
const { normalizeSpokenCopy, semanticCopyEqual } = require('../src/v2.8.1/spoken-copy-contract');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const brand = { id: BRAND_ID, workspaceId: WORKSPACE_ID, name: 'Test Brand', status: 'ACTIVE',
  mission: 'Synthetic test mission', products: [], audiences: [], offers: [], campaigns: [] };
const profile = resolveQualityVideoProfile({ QUALITY_VIDEO_MODEL: 'test-owner/quality-video' });

function request(sceneCount, overrides = {}) {
  return { requestId: '33333333-3333-4333-8333-333333333333', brandId: BRAND_ID, renderMode: 'QUALITY',
    title: `Synthetic ${sceneCount} scene`, objective: 'ENGAGEMENT', platform: 'Reels',
    targetDurationSeconds: sceneCount * 5, aspectRatio: '9:16', hook: 'Notice the opening signal.',
    coreMessage: 'Attention reveals context and creates a more informed response.', cta: 'Pause and respond.',
    creativeBrief: 'Synthetic human interaction for contract testing only.', ...overrides };
}

function built(sceneCount, overrides = {}) {
  return buildOperatorProductionInput(request(sceneCount, overrides), brand, { qualityProfile: profile }).input;
}

function clone(value) { return structuredClone(value); }
function check(result, code) { return result.checks.find((item) => item.code === code); }

function preflight(input) {
  return validatePreExecutionQuality({ productionId: 'preflight-test', script: input.script,
    shotPlan: input.shotPlan, assetPlan: input.assetPlan,
    policy: { requireVoiceForSpokenCopy: true, strictApprovedCopy: true,
      requireVoiceTimingPlan: true, requireProviderCompatibility: true } });
}

async function preflightBoundary(input) {
  let laneCalls = 0;
  const db = { async query(sql) {
    if (sql.includes('database-health')) return { rows: [{}] };
    if (sql.includes('get-brand')) return { rows: [brand] };
    if (sql.includes('inspect-existing')) return { rows: [] };
    throw new Error(`Unexpected preflight SQL: ${sql}`);
  } };
  const rendererRouter = {
    async preflight() { laneCalls += 1; return { availability: { status: 'READY' }, executions: [] }; },
    plan() { return { renderMode: 'QUALITY', renderer: 'v2.5-quality', expectedPaidProviderCalls: input.assetPlan.assets.length,
      expectedVideoGenerations: input.assetPlan.assets.filter((asset) => asset.kind === 'video').length,
      expectedAudioGenerations: 1, rendererAvailability: { status: 'READY' } }; },
  };
  const service = new LiveProductionService({ db, rendererRouter, artifactService: { createVersion() {} }, storageRoot: '/tmp',
    storageValidator: async () => {}, schemaInspector: async () => ({ compatible: true, counts: { error: 0 }, issues: [] }),
    transactionProbe: async () => ({ passed: true, providerCalls: 0 }), storageProbe: async () => ({ passed: true }) });
  try {
    const prepared = await service.prepare({ input, config: { live: false } });
    return { status: prepared.plan.readiness, providerExecutions: 0, laneCalls, prepared };
  } catch (error) {
    return { status: 'NOT_READY', providerExecutions: error.details?.providerExecutions, laneCalls, error };
  }
}

async function main() {
  for (const count of [1, 2, 3, 4, 5, 6]) {
    const input = built(count);
    const result = preflight(input);
    assert.equal(result.status, 'PASS', `${count}-scene canonical plan must pass`);
    assert.equal(semanticCopyEqual(input.script.scenes.map((scene) => scene.dialogue_or_voiceover).join(' '),
      input.approvedSpokenCopy), true, `${count}-scene distribution preserves all approved copy`);
    assert.equal(input.assetPlan.assets.find((asset) => asset.kind === 'voice').generation_requirements.text,
      input.approvedSpokenCopy);
    if (count >= 4) {
      const occurrences = input.script.scenes.filter((scene) => normalizeSpokenCopy(scene.dialogue_or_voiceover)
        === normalizeSpokenCopy(input.coreMessage)).length;
      assert.equal(occurrences, 0, '4+ scene plans must not repeat the full core message in middle scenes');
    }
  }
  const two = built(2);
  assert.match(two.script.scenes.map((scene) => scene.dialogue_or_voiceover).join(' '), /Attention reveals context/,
    'two-scene distribution must not lose the core message');

  const explicit = 'Notice the opening signal.   A deliberately operator-written middle! Pause and respond.';
  const explicitInput = built(3, { voiceover: explicit });
  assert.equal(explicitInput.approvedSpokenCopy, explicit, 'explicit operator voiceover remains byte-for-byte authoritative after trimming');
  assert.equal(explicitInput.assetPlan.assets.find((asset) => asset.kind === 'voice').generation_requirements.text, explicit);
  assert.equal(preflight(explicitInput).status, 'PASS');

  const missingHook = clone(explicitInput);
  missingHook.script.hook = 'An absent required hook.';
  assert.equal(check(preflight(missingHook), 'editorial_hook').status, 'FAIL');
  const missingCta = clone(explicitInput);
  missingCta.script.cta = 'An absent required CTA.';
  assert.equal(check(preflight(missingCta), 'editorial_cta').status, 'FAIL');

  const missingApproved = clone(two);
  missingApproved.assetPlan.assets.find((asset) => asset.kind === 'voice').generation_requirements.text = 'Notice the opening signal. Pause and respond.';
  assert.equal(check(preflight(missingApproved), 'voice_copy_integrity').status, 'FAIL');
  const injected = clone(two);
  injected.assetPlan.assets.find((asset) => asset.kind === 'voice').generation_requirements.text += ' Unapproved injected speech.';
  assert.equal(check(preflight(injected), 'voice_copy_integrity').status, 'FAIL');
  const punctuation = clone(two);
  punctuation.assetPlan.assets.find((asset) => asset.kind === 'voice').generation_requirements.text =
    two.approvedSpokenCopy.replaceAll('.', ' ... ').replaceAll(' ', '   ');
  assert.equal(check(preflight(punctuation), 'voice_copy_integrity').status, 'PASS');
  const boundaries = clone(two);
  const allCopy = boundaries.approvedSpokenCopy.split(/\s+/);
  boundaries.script.scenes[0].dialogue_or_voiceover = allCopy.slice(0, 3).join(' ');
  boundaries.script.scenes[1].dialogue_or_voiceover = allCopy.slice(3).join(' ');
  assert.equal(check(preflight(boundaries), 'scene_copy_distribution').status, 'PASS');

  const badCopyBoundary = await preflightBoundary(missingApproved);
  assert.equal(badCopyBoundary.status, 'NOT_READY'); assert.equal(badCopyBoundary.providerExecutions, 0);
  assert.equal(badCopyBoundary.laneCalls, 0, 'invalid deterministic copy stops before execution-lane planning');
  const badTiming = clone(two); badTiming.script.scenes[0].duration_seconds += 1;
  const badTimingBoundary = await preflightBoundary(badTiming);
  assert.equal(badTimingBoundary.status, 'NOT_READY'); assert.equal(badTimingBoundary.providerExecutions, 0);
  const badReference = clone(two); badReference.shotPlan.shots[0].scene_id = 'missing-scene';
  const badReferenceBoundary = await preflightBoundary(badReference);
  assert.equal(badReferenceBoundary.status, 'NOT_READY'); assert.equal(badReferenceBoundary.providerExecutions, 0);
  const ready = await preflightBoundary(two);
  assert.equal(ready.status, 'READY'); assert.equal(ready.providerExecutions, 0);

  let providerExecutions = 0;
  const orchestrator = new MasterProductionOrchestrator({ providerGateway: { async generate() { providerExecutions += 1; } },
    artifactService: { async createVersion() {} }, renderer: { async render() {} } });
  await assert.rejects(() => orchestrator.build({ productionId: 'blocked-production', brandId: BRAND_ID, workerId: 'worker',
    script: badReference.script, shotPlan: badReference.shotPlan, assetPlan: badReference.assetPlan,
    qualityPolicy: { requireProviderCompatibility: true } }), (error) => error.code === 'PRE_EXECUTION_VALIDATION_FAILED');
  assert.equal(providerExecutions, 0, 'invalid deterministic input cannot cross the paid provider boundary');

  const timeline = buildMasterTimeline({ productionId: 'post-render', script: two.script, shotPlan: two.shotPlan, assetPlan: two.assetPlan });
  const validProbe = { width: 1080, height: 1920, fps: 30, durationMs: timeline.durationMs, videoCodec: 'h264', hasAudio: true };
  assert.equal(validatePostRenderQuality({ timeline, probe: validProbe }).status, 'PASS');
  const postCases = [
    ['resolution', { width: 720 }], ['frame_rate', { fps: 24 }], ['duration', { durationMs: timeline.durationMs - 2000 }],
    ['video_codec', { videoCodec: null }], ['audio_track', { hasAudio: false }],
  ];
  for (const [code, change] of postCases) {
    assert.equal(check(validatePostRenderQuality({ timeline, probe: { ...validProbe, ...change } }), code).status, 'FAIL');
  }

  for (const provider of ['replicate','fal','runway','google','luma']) {
    const neutral = clone(two);
    neutral.assetPlan.assets.filter((asset) => asset.kind === 'video').forEach((asset) => {
      asset.generation_requirements.provider = provider;
      asset.generation_requirements.model = `${provider}/synthetic-model`;
    });
    assert.equal(preflight(neutral).status, 'PASS', `${provider} plan must use provider-neutral spoken-copy validation`);
  }

  const failedLifecycle = { id: 'production', jobId: 'job', jobStatus: 'RETRYING', status: 'RUNNING',
    validationStatus: 'FAIL', reviewState: 'BLOCKED', validationEvidence: { masterArtifact: { id: 'master', version: 1 } } };
  assert.deepEqual(progressFor(failedLifecycle).map((stage) => [stage.label, stage.status]), [
    ['Planning','COMPLETED'], ['Provider Generation','COMPLETED'], ['Master Assembly','COMPLETED'],
    ['Validation','FAILED'], ['Human Review','BLOCKED'],
  ]);
  const successLifecycle = { ...failedLifecycle, jobStatus: 'COMPLETED', status: 'COMPLETED',
    validationStatus: 'PASS', reviewState: 'AWAITING_HUMAN_APPROVAL' };
  assert.equal(progressFor(successLifecycle).at(-1).status, 'RUNNING');

  let persistedError = null;
  const persistenceService = new LiveProductionService({ db: { async query(sql, values) {
    if (sql.includes('fail-live-job')) persistedError = JSON.parse(values[3]);
    return { rows: [] };
  } }, rendererRouter: { preflight() {}, plan() {} }, artifactService: { createVersion() {} }, storageRoot: '/tmp' });
  await persistenceService.fail({ productionId: 'production', jobId: 'job', workerId: 'worker',
    providerBoundaryCrossed: true, durableAssetRecovery: true,
    error: { code: 'LIVE_MASTER_VALIDATION_FAILED', message: 'Synthetic validation failure', details: {
      quality: { status: 'FAIL', score: 0.5, validationClass: 'COMBINED', checks: [{ code: 'duration', status: 'FAIL',
        message: 'Synthetic mismatch', details: { actual: 1, expected: 2 } }] },
      masterArtifact: { id: 'master', version: 1, storageKey: 'synthetic/master.mp4' },
    } } });
  assert.equal(persistedError.validation.status, 'FAIL');
  assert.equal(persistedError.validation.checks[0].details.actual, 1);
  assert.equal(persistedError.validation.masterArtifact.id, 'master');
  assert.ok(Date.parse(persistedError.validation.timestamp));
  assert.equal(two.publicationPolicy.autoPublish, false);

  console.log('V2.8.1 canonical copy, zero-call preflight, post-render, lifecycle, and provider-neutral validation passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
