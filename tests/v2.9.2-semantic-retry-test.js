'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { partialMediaPlan, SemanticEvaluationRetryService, retryPlan } = require('../src/v2.9/semantic-evaluation-retry');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { sourceFailureNextAction } = require('../worker/v2.1-master-production');

const frameBytes = Buffer.from('existing immutable sampled frame');
const frameHash = crypto.createHash('sha256').update(frameBytes).digest('hex');
const frameDescriptor = Object.freeze({ ratio: 0.5, timestampMs: 1000, analysisHash: 'analysis-1',
  storageKey: 'frame-1.jpg', contentHash: frameHash, artifactId: 'quality:frame:1', artifactVersion: 1,
  contentType: 'image/jpeg' });
const deterministicVisual = qualityResult({ qualityClass: 'SOURCE_VISUAL', checks: [qualityCheck({
  code: 'SOURCE_TECHNICAL_PASS', status: 'PASS', qualityClass: 'SOURCE_VISUAL', reason: 'Existing technical evidence passed.',
})] });
const temporal = qualityResult({ qualityClass: 'TEMPORAL_QUALITY', checks: [qualityCheck({
  code: 'SOURCE_TEMPORAL_PASS', status: 'PASS', qualityClass: 'TEMPORAL_QUALITY', reason: 'Existing temporal evidence passed.',
})] });

function productionWith(code) {
  const semantic = qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
    code, status: 'FAIL', qualityClass: 'SEMANTIC_VISUAL', reason: 'Evaluator infrastructure response failed.', hardFailure: false,
  })] });
  const shot = { assetId: 'operator-video-1', status: 'FAIL', deterministicVisual, temporal, semantic,
    sampledFrames: [frameDescriptor],
    evidenceArtifact: { artifactId: 'quality:evaluation', version: 1, contentHash: 'previous-evidence' } };
  return { id: '29449687-4f0a-450b-bba2-f71b0f94cff0', workspaceId: 'workspace-1', brandId: 'brand-1', jobId: 'job-1',
    jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', details: { sourceQuality: { shots: [shot] } } } };
}

const input = { captions: { enabled: false }, creativePlan: {}, voiceover: { enabled: true },
  spokenCopyPolicy: { strictApprovedCopy: true }, script: {}, shotPlan: {}, assetPlan: { assets: [{
    asset_id: 'operator-video-1', kind: 'video', generation_requirements: { profile: 'STANDARD', aspect_ratio: '9:16' },
  }, { asset_id: 'voiceover-main', kind: 'voice', generation_requirements: { text: 'Approved canonical spoken copy.',
    provider: 'openai-media', model: 'tts-test', voice: 'alloy' } }] } };

function passingEvaluation() {
  const semantic = qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
    code: REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, status: 'PASS', qualityClass: 'SEMANTIC_VISUAL',
    reason: 'No prohibited brand-safety element is visible.',
  })], metadata: { externalCalls: 1 } });
  return { ...qualityResult({ qualityClass: 'SOURCE_VISUAL_GATE', checks: [
    ...deterministicVisual.checks, ...temporal.checks, ...semantic.checks,
  ], metadata: { semanticOnlyRetry: true } }), deterministicVisual, temporal, semantic,
  sampledFrames: [{ ...frameDescriptor, bytes: frameBytes, jpeg: frameBytes }] };
}

async function exercise({ semanticStatus = 'PASS', voiceState = 'REUSED', sourceExists = true,
  latestAttempt = null, speechStageError = null } = {}) {
  const calls = { video: 0, speech: 0, semantic: 0, assembly: 0, attempts: [], order: [] };
  const sourceArtifact = Object.freeze({ artifactId: 'brand:brand-1:asset:operator-video-1', version: 1,
    storageKey: 'immutable-video.mp4', contentHash: 'video-content-hash' });
  const sourceRow = sourceExists ? { asset_id: 'operator-video-1', kind: 'video', status: 'SUCCEEDED',
    artifact_storage_key: sourceArtifact.storageKey, artifact_content_hash: sourceArtifact.contentHash } : null;
  const voiceRow = voiceState === 'REUSED' ? { asset_id: 'voiceover-main', kind: 'voice', status: 'SUCCEEDED',
    artifact_storage_key: 'immutable-voice.mp3', artifact_content_hash: 'voice-content-hash' }
    : voiceState === 'AMBIGUOUS' ? { asset_id: 'voiceover-main', kind: 'voice', status: 'NEEDS_RECONCILIATION' }
      : null;
  const repository = { async inspectSchema() { return { ready: true }; }, async latest() { return latestAttempt; }, async start(args) {
    calls.attempts.push({ status: 'RUNNING', previousEvidence: args.previousEvidence, mediaPlan: args.mediaPlan,
      expectedSemanticCalls: args.expectedSemanticCalls, reusedSemanticAttemptId: args.reusedSemanticAttemptId,
      recoveryPhase: args.recoveryPhase });
    return { id: 'attempt-2' };
  }, async finish(args) { calls.attempts.push(args); return args; } };
  const executionRepository = { async get({ assetId }) {
    return assetId === 'operator-video-1' ? sourceRow : voiceRow;
  } };
  const mediaExecutor = { repository: executionRepository, async execute({ asset }) {
    calls.order.push(`generate:${asset.kind}`);
    if (asset.kind === 'video') { calls.video += 1; throw new Error('Video generation invariant violated'); }
    if (speechStageError) throw Object.assign(new Error(speechStageError), { code: 'SPEECH_STAGE_FAILED' });
    calls.speech += 1;
    assert.equal(asset.generation_requirements.text, 'Approved canonical spoken copy.');
    assert.deepEqual([asset.generation_requirements.provider, asset.generation_requirements.model,
      asset.generation_requirements.voice], ['openai-media','tts-test','alloy']);
    return { assetId: asset.asset_id, kind: 'voice', provider: 'openai-media', model: 'tts-test',
      artifact: Object.freeze({ artifactId: 'brand:brand-1:asset:voiceover-main', version: 1,
        storageKey: 'new-voice.mp3', contentHash: 'new-voice-content-hash' }), bytes: Buffer.from('new-voice') };
  }, async loadExisting({ asset }) {
    calls.order.push(`load:${asset.asset_id}`);
    if (asset.kind === 'video' && sourceExists) return { assetId: asset.asset_id, kind: 'video', provider: 'replicate',
      model: 'alibaba/wan-3', artifact: sourceArtifact, bytes: Buffer.from('existing-video') };
    if (asset.kind === 'voice' && voiceState === 'REUSED') return { assetId: asset.asset_id, kind: 'voice', provider: 'openai-media', model: 'tts-test',
      artifact: Object.freeze({ artifactId: 'brand:brand-1:asset:operator-voice-1', version: 1,
        storageKey: 'immutable-voice.mp3', contentHash: 'voice-content-hash' }), bytes: Buffer.from('existing-voice') };
    throw Object.assign(new Error(`Missing ${asset.asset_id}`), { code: 'SEMANTIC_RETRY_MEDIA_MISSING' });
  } };
  const evaluator = { semanticAdapter: { provider: 'openai', model: 'semantic-test' }, async retrySemantic() {
    calls.semantic += 1; calls.order.push('semantic');
    if (semanticStatus === 'PASS') return passingEvaluation();
    return { ...passingEvaluation(), status: 'FAIL', semantic: qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
      code: REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, status: 'FAIL', qualityClass: 'SEMANTIC_VISUAL',
      reason: 'A prohibited element is visibly present.',
    })], metadata: { externalCalls: 1 } }) };
  } };
  const masterOrchestrator = { async build(args) { calls.assembly += 1;
    calls.order.push('assembly');
    assert.strictEqual(args.resolvedMedia.find((media) => media.assetId === 'operator-video-1').artifact,
      sourceArtifact, 'immutable source identity must be reused');
    assert.equal(args.resolvedMedia.length, 2, 'video and resolved voice are required for assembly');
    assert.equal(args.semanticRecovery.assetId, 'operator-video-1');
    assert.equal(Buffer.isBuffer(args.semanticRecovery.evaluation.sampledFrames[0].jpeg), true,
      'master must receive materialized immutable JPEG bytes, never JSON-round-tripped Buffer objects');
    assert.deepEqual(args.semanticRecovery.evaluation.sampledFrames[0].jpeg, frameBytes);
    return { master: { artifact: { artifactId: 'master', version: 1, storageKey: 'master.mp4' } }, quality: { status: 'PASS' } };
  } };
  const service = new SemanticEvaluationRetryService({ repository,
    storage: { async get({ key }) { assert.equal(key, 'frame-1.jpg'); return frameBytes; } },
    mediaExecutor, evaluator, masterOrchestrator });
  try { return { value: await service.execute({ production: productionWith(
    REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE), input, workerId: 'test' }), calls, sourceArtifact }; }
  catch (error) { return { error, calls, sourceArtifact }; }
}

async function main() {
  const plan = retryPlan(productionWith(REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE), input);
  assert.equal(plan.eligible, true);
  assert.deepEqual([plan.expectedVideoGenerations, plan.expectedSpeechGenerations,
    plan.expectedSemanticEvaluations], [0, 0, 1]);
  assert.equal(retryPlan(productionWith(REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT), input).eligible, false,
    'real semantic defects must require regeneration/revision, not evaluator retry');
  const malformedShot = productionWith(REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE)
    .jobError.details.sourceQuality.shots[0];
  assert.equal(sourceFailureNextAction(malformedShot), 'RETRY_SEMANTIC_EVALUATION');
  assert.equal(sourceFailureNextAction(productionWith(REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT)
    .jobError.details.sourceQuality.shots[0]), 'REGENERATE_SHOT');

  const missingPlan = partialMediaPlan({ input, sourceAssetId: 'operator-video-1', executions: [
    { asset_id: 'operator-video-1', status: 'SUCCEEDED', artifact_storage_key: 'video', artifact_content_hash: 'hash' },
  ] });
  assert.equal(missingPlan.existingSourceVideo, true);
  assert.equal(missingPlan.reusedSpeechAssets, 0);
  assert.equal(missingPlan.possiblePostPassSpeechGenerations, 1);

  const missingVoice = await exercise({ voiceState: 'MISSING' });
  assert.ifError(missingVoice.error);
  assert.deepEqual([missingVoice.calls.video, missingVoice.calls.semantic, missingVoice.calls.speech], [0, 1, 1]);
  assert(missingVoice.calls.order.indexOf('semantic') < missingVoice.calls.order.indexOf('generate:voice'));
  assert.equal(missingVoice.calls.assembly, 1);
  assert.deepEqual([missingVoice.value.newVideoGenerations, missingVoice.value.semanticEvaluations,
    missingVoice.value.newSpeechGenerations], [0, 1, 1]);

  const postPassFailure = await exercise({ voiceState: 'MISSING', speechStageError: 'speech adapter failed before HTTP' });
  assert.equal(postPassFailure.error.code, 'SPEECH_STAGE_FAILED');
  assert.deepEqual([postPassFailure.calls.video, postPassFailure.calls.semantic,
    postPassFailure.calls.speech, postPassFailure.calls.assembly], [0, 1, 0, 0]);
  const failedAttempt = postPassFailure.calls.attempts.at(-1);
  assert.equal(failedAttempt.recoveryPhase, 'POST_PASS_MEDIA_FAILED');
  const resumed = await exercise({ voiceState: 'MISSING', latestAttempt: {
    id: 'attempt-1', attempt: 1, status: 'FAILED', source_artifact: postPassFailure.sourceArtifact,
    previous_evidence: productionWith(REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE)
      .jobError.details.sourceQuality.shots[0],
    result_evidence: failedAttempt.resultEvidence, evaluator_provider: 'openai', evaluator_model: 'semantic-test',
    recovery_phase: 'POST_PASS_MEDIA_FAILED',
  } });
  assert.ifError(resumed.error);
  assert.deepEqual([resumed.calls.video, resumed.calls.semantic, resumed.calls.speech, resumed.calls.assembly], [0, 0, 1, 1]);
  assert.equal(resumed.calls.attempts[0].expectedSemanticCalls, 0);
  assert.equal(resumed.calls.attempts[0].reusedSemanticAttemptId, 'attempt-1');
  assert.equal(resumed.value.reusedSemanticAttemptId, 'attempt-1');
  const stalePass = await exercise({ voiceState: 'MISSING', latestAttempt: {
    id: 'stale-attempt', attempt: 9, status: 'FAILED',
    source_artifact: { ...postPassFailure.sourceArtifact, contentHash: 'different-source-hash' },
    previous_evidence: productionWith(REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE)
      .jobError.details.sourceQuality.shots[0],
    result_evidence: failedAttempt.resultEvidence, evaluator_provider: 'openai', evaluator_model: 'semantic-test',
  } });
  assert.ifError(stalePass.error);
  assert.equal(stalePass.calls.semantic, 1, 'PASS evidence for a different source hash must not be reused');

  const existingVoice = await exercise({ voiceState: 'REUSED' });
  assert.ifError(existingVoice.error);
  assert.deepEqual([existingVoice.calls.video, existingVoice.calls.semantic, existingVoice.calls.speech], [0, 1, 0]);
  assert.equal(existingVoice.value.reusedSpeechAssets, 1);

  const semanticFailure = await exercise({ semanticStatus: 'FAIL', voiceState: 'MISSING' });
  assert.equal(semanticFailure.error.code, 'SEMANTIC_RETRY_FAILED');
  assert.deepEqual([semanticFailure.calls.video, semanticFailure.calls.semantic,
    semanticFailure.calls.speech, semanticFailure.calls.assembly], [0, 1, 0, 0]);
  assert.equal(semanticFailure.calls.attempts.at(-1).recoveryPhase, 'SEMANTIC_FAILED');

  const ambiguousSpeech = await exercise({ voiceState: 'AMBIGUOUS' });
  assert.equal(ambiguousSpeech.error.code, 'SEMANTIC_RETRY_SPEECH_RECONCILIATION_REQUIRED');
  assert.deepEqual([ambiguousSpeech.calls.video, ambiguousSpeech.calls.semantic,
    ambiguousSpeech.calls.speech, ambiguousSpeech.calls.assembly], [0, 1, 0, 0]);
  assert.equal(ambiguousSpeech.calls.attempts.at(-1).resultEvidence.status, 'PASS',
    'semantic PASS evidence must survive a later speech reconciliation block');
  assert.equal(ambiguousSpeech.calls.attempts.at(-1).newVideoGenerations, 0);

  const missingSource = await exercise({ sourceExists: false, voiceState: 'MISSING' });
  assert.equal(missingSource.error.code, 'SEMANTIC_RETRY_SOURCE_MISSING');
  assert.deepEqual([missingSource.calls.video, missingSource.calls.semantic,
    missingSource.calls.speech, missingSource.calls.assembly], [0, 0, 0, 0]);
  console.log('V2.9.2.2 capability-scoped semantic recovery and semantic-PASS resume passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });