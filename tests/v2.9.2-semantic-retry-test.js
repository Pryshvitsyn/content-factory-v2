'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SemanticEvaluationRetryService, retryPlan } = require('../src/v2.9/semantic-evaluation-retry');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { sourceFailureNextAction } = require('../worker/v2.1-master-production');

const frameBytes = Buffer.from('existing immutable sampled frame');
const frameHash = crypto.createHash('sha256').update(frameBytes).digest('hex');
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
    sampledFrames: [{ ratio: 0.5, timestampMs: 1000, analysisHash: 'analysis-1', storageKey: 'frame-1.jpg',
      contentHash: frameHash, artifactId: 'quality:frame:1', artifactVersion: 1 }],
    evidenceArtifact: { artifactId: 'quality:evaluation', version: 1, contentHash: 'previous-evidence' } };
  return { id: '29449687-4f0a-450b-bba2-f71b0f94cff0', workspaceId: 'workspace-1', brandId: 'brand-1', jobId: 'job-1',
    jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', details: { sourceQuality: { shots: [shot] } } } };
}

const input = { captions: { enabled: false }, creativePlan: {}, voiceover: { enabled: false },
  spokenCopyPolicy: { strictApprovedCopy: true }, script: {}, shotPlan: {}, assetPlan: { assets: [{
    asset_id: 'operator-video-1', kind: 'video', generation_requirements: { profile: 'STANDARD', aspect_ratio: '9:16' },
  }, { asset_id: 'operator-voice-1', kind: 'voice', generation_requirements: {} }] } };

function passingEvaluation() {
  const semantic = qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
    code: REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, status: 'PASS', qualityClass: 'SEMANTIC_VISUAL',
    reason: 'No prohibited brand-safety element is visible.',
  })], metadata: { externalCalls: 1 } });
  return { ...qualityResult({ qualityClass: 'SOURCE_VISUAL_GATE', checks: [
    ...deterministicVisual.checks, ...temporal.checks, ...semantic.checks,
  ] }), deterministicVisual, temporal, semantic, sampledFrames: [] };
}

async function exercise(resultStatus) {
  const calls = { video: 0, speech: 0, semantic: 0, assembly: 0, attempts: [] };
  const sourceArtifact = Object.freeze({ artifactId: 'brand:brand-1:asset:operator-video-1', version: 1,
    storageKey: 'immutable-video.mp4', contentHash: 'video-content-hash' });
  const repository = { async inspectSchema() { return { ready: true }; }, async start(args) {
    calls.attempts.push({ status: 'RUNNING', previousEvidence: args.previousEvidence }); return { id: 'attempt-2' };
  }, async finish(args) { calls.attempts.push(args); return args; } };
  const mediaExecutor = { async execute({ asset }) {
    if (asset.kind === 'video') calls.video += 1; else calls.speech += 1;
    throw new Error('Generation must never be invoked by semantic retry');
  }, async loadExisting({ asset }) {
    if (asset.kind === 'video') return { assetId: asset.asset_id, kind: 'video', provider: 'replicate',
      model: 'alibaba/wan-3', artifact: sourceArtifact, bytes: Buffer.from('existing-video') };
    return { assetId: asset.asset_id, kind: 'voice', provider: 'openai-media', model: 'tts-test',
      artifact: Object.freeze({ artifactId: 'brand:brand-1:asset:operator-voice-1', version: 1,
        storageKey: 'immutable-voice.mp3', contentHash: 'voice-content-hash' }), bytes: Buffer.from('existing-voice') };
  } };
  const evaluator = { semanticAdapter: { provider: 'openai', model: 'semantic-test' }, async retrySemantic() {
    calls.semantic += 1;
    if (resultStatus === 'PASS') return passingEvaluation();
    return { ...passingEvaluation(), status: 'FAIL', semantic: qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
      code: REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, status: 'FAIL', qualityClass: 'SEMANTIC_VISUAL',
      reason: 'A prohibited element is visibly present.',
    })], metadata: { externalCalls: 1 } }) };
  } };
  const masterOrchestrator = { async build(args) { calls.assembly += 1;
    assert.strictEqual(args.resolvedMedia.find((media) => media.assetId === 'operator-video-1').artifact,
      sourceArtifact, 'immutable source identity must be reused');
    assert.equal(args.resolvedMedia.length, 2, 'existing video and voice assets must both be reused');
    assert.equal(args.semanticRecovery.assetId, 'operator-video-1');
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

  const success = await exercise('PASS');
  assert.ifError(success.error);
  assert.deepEqual([success.calls.video, success.calls.speech, success.calls.semantic], [0, 0, 1]);
  assert.equal(success.calls.assembly, 1, 'PASS may proceed to cached master assembly');
  assert.equal(success.value.videoGenerations, 0);
  assert.equal(success.value.speechGenerations, 0);
  assert.equal(success.value.semanticEvaluations, 1);
  assert.equal(success.calls.attempts[0].previousEvidence.evidenceArtifact.contentHash, 'previous-evidence');
  assert.equal(success.calls.attempts.at(-1).status, 'SUCCEEDED');

  const failure = await exercise('FAIL');
  assert.equal(failure.error.code, 'SEMANTIC_RETRY_FAILED');
  assert.deepEqual([failure.calls.video, failure.calls.speech, failure.calls.semantic], [0, 0, 1]);
  assert.equal(failure.calls.assembly, 0, 'FAIL must leave master assembly blocked');
  assert.equal(failure.calls.attempts.at(-1).status, 'FAILED');
  console.log('V2.9.2 semantic-only retry contract passed (video 0, speech 0, semantic 1; provider calls mocked).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
