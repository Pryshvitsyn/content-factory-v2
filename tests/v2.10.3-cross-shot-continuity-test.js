'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { FfmpegReferenceGeometryNormalizer, geometry } = require('../src/v2.10.2/reference-geometry');
const { VisualQualityEvaluator } = require('../src/v2.9/visual-quality-evaluator');
const { FunctionSemanticVisualEvaluatorAdapter } = require('../src/v2.9/semantic-visual-evaluator');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { semanticEvaluationPlan } = require('../src/v2.9/semantic-evaluation-policy');
const { buildProductionQuality } = require('../src/v2.9/audio-editorial-quality');
const { QualityRecoveryService, continuityFailures } = require('../src/v2.10.1/quality-recovery-service');

function qualityFrame(index) {
  return Object.freeze({ ratio: index / 6, timestampMs: index * 700,
    analysisHash: `frame-${index}`, jpeg: Buffer.from(`jpeg-${index}`),
    differenceFromPrevious: index ? 8 : null,
    metrics: Object.freeze({ mean: 100, standardDeviation: 30, darkRatio: 0,
      rowDarkRatios: Object.freeze(Array(90).fill(0)), columnDarkRatios: Object.freeze(Array(160).fill(0)) }) });
}

function sourcePass(tier) {
  return qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier, checks: [
    qualityCheck({ code: REASON_CODES.SINGLE_COHERENT_COMPOSITION, status: 'PASS',
      qualityClass: 'SEMANTIC_VISUAL', reason: 'One coherent composition is visible.', confidence: 0.99 }),
    qualityCheck({ code: REASON_CODES.HUMAN_VISUAL_INTEGRITY, status: 'PASS',
      qualityClass: 'SEMANTIC_VISUAL', reason: 'Humans are internally plausible in this clip.', confidence: 0.99 }),
  ], metadata: { externalCalls: 0, evaluationType: 'semantic_visual_evaluation' } });
}

function continuityResult(tier, failIdentity = false) {
  return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier, checks: [qualityCheck({
    code: failIdentity ? REASON_CODES.CHARACTER_IDENTITY_DRIFT : REASON_CODES.VISUAL_IDENTITY_CONTINUITY,
    status: failIdentity ? 'FAIL' : 'PASS', qualityClass: 'CONTINUITY_QUALITY', confidence: 0.99,
    reason: failIdentity ? 'The face and apparent identity materially change between shots.'
      : 'The same characters remain visually consistent across the compared shots.',
  })], metadata: { externalCalls: 1, evaluationType: 'continuity_evaluation' } });
}

function media(assetId, productionId = 'prod-1', width = 720, height = 1280, version = 1) {
  return Object.freeze({ assetId, productionId, brandId: 'brand-1', bytes: Buffer.from(`video-${assetId}`),
    contentType: 'video/mp4', mediaProbe: Object.freeze({ width, height, durationMs: 5000, fps: 30,
      videoCodec: 'h264', size: 1000, hasAudio: false }), provider: 'fixture', model: 'fixture-video',
    artifact: Object.freeze({ artifactId: `artifact-${assetId}`, version,
      contentHash: `hash-${assetId}-v${version}`, storageKey: `${assetId}-v${version}.mp4` }) });
}

const creativePlan = Object.freeze({ shots: Object.freeze([
  Object.freeze({ shotId: 'shot-1', assetId: 'video-1', framing: 'medium-wide', action: 'She grows quieter.' }),
  Object.freeze({ shotId: 'shot-2', assetId: 'video-2', framing: 'closer medium', action: 'He softens and reaches for her hand.' }),
  Object.freeze({ shotId: 'shot-3', assetId: 'video-3', framing: 'medium close', action: 'Connection returns.' }),
]), continuity: Object.freeze({ identity: 'same couple', wardrobe: 'same wardrobe', environment: 'same room' }) });

async function geometryPolicyTests() {
  const unsafe = new FfmpegReferenceGeometryNormalizer();
  unsafe.probe = async (bytes) => String(bytes) === 'rotated' ? geometry(720, 1280) : geometry(1280, 720);
  unsafe.inspectSourceRotation = async () => ({ rotationDegrees: null, evidence: 'NO_QUARTER_TURN_DISPLAY_METADATA' });
  unsafe.transformImage = async () => Buffer.from('rotated');
  await assert.rejects(() => unsafe.normalizePreviousShot({ bytes: Buffer.from('landscape'),
    expectedAspectRatio: '9:16', resolution: '720p', sourceVideoBytes: Buffer.from('source') }),
  (error) => error.code === 'REFERENCE_GEOMETRY_ORIENTATION_INVERSION');

  const rotatable = new FfmpegReferenceGeometryNormalizer();
  rotatable.probe = async (bytes) => String(bytes) === 'rotated' ? geometry(720, 1280) : geometry(1280, 720);
  rotatable.inspectSourceRotation = async () => ({ rotationDegrees: 90, evidence: 'FFPROBE_DISPLAY_METADATA' });
  rotatable.transformImage = async () => Buffer.from('rotated');
  const corrected = await rotatable.normalizePreviousShot({ bytes: Buffer.from('landscape'),
    expectedAspectRatio: '9:16', resolution: '720p', sourceVideoBytes: Buffer.from('source') });
  assert.equal(corrected.policy, 'ROTATE_FROM_SOURCE_DISPLAY_METADATA');
  assert.equal(corrected.after.orientation, 'PORTRAIT');
  assert.equal(corrected.sourceRotationDegrees, 90);
}

async function continuityGateTests() {
  let continuityCalls = 0;
  const passingAdapter = new FunctionSemanticVisualEvaluatorAdapter({ provider: 'fixture-continuity', model: 'v2.10.3',
    estimatedCallsPerEvaluation: 0, estimatedContinuityCalls: 1,
    evaluate: async ({ qualityTier }) => sourcePass(qualityTier),
    evaluateContinuity: async ({ qualityTier }) => { continuityCalls += 1; return continuityResult(qualityTier, false); } });
  const evaluator = new VisualQualityEvaluator({ frameSampler: { async sample() {
    return Object.freeze(Array.from({ length: 7 }, (_, index) => qualityFrame(index)));
  } }, semanticAdapter: passingAdapter });

  const shot1 = await evaluator.evaluate({ media: media('video-1'), creativePlan, qualityTier: 'STANDARD',
    expectedAspectRatio: '9:16', provider: 'fixture', model: 'fixture-video' });
  assert.notEqual(shot1.status, 'FAIL');
  assert.equal(continuityCalls, 0, 'shot 1 must not spend continuity evaluation');

  const shot2 = await evaluator.evaluate({ media: media('video-2'), creativePlan, qualityTier: 'STANDARD',
    expectedAspectRatio: '9:16', provider: 'fixture', model: 'fixture-video' });
  assert.notEqual(shot2.status, 'FAIL');
  assert.equal(continuityCalls, 1, 'shot 2 must be continuity-gated before any dependent shot');
  assert.equal(shot2.continuity.metadata.incrementalGate, true);
  assert.equal(shot2.continuity.metadata.comparedArtifactVersions.length, 2);

  const shot3 = await evaluator.evaluate({ media: media('video-3'), creativePlan, qualityTier: 'STANDARD',
    expectedAspectRatio: '9:16', provider: 'fixture', model: 'fixture-video' });
  assert.notEqual(shot3.status, 'FAIL');
  assert.equal(continuityCalls, 2, 'three shots require two incremental continuity evaluations');

  const aggregate = await evaluator.evaluateContinuity({ qualityTier: 'STANDARD', creativePlan,
    shotEvaluations: [{ shotId: 'shot-1', assetId: 'video-1', evaluation: shot1 },
      { shotId: 'shot-2', assetId: 'video-2', evaluation: shot2 },
      { shotId: 'shot-3', assetId: 'video-3', evaluation: shot3 }] });
  assert.equal(continuityCalls, 2, 'final source aggregation must reuse incremental evidence and make no duplicate call');
  assert.equal(aggregate.metadata.externalCalls, 2);

  let failingCalls = 0;
  const failingAdapter = new FunctionSemanticVisualEvaluatorAdapter({ provider: 'fixture-continuity', model: 'v2.10.3',
    estimatedCallsPerEvaluation: 0, estimatedContinuityCalls: 1,
    evaluate: async ({ qualityTier }) => sourcePass(qualityTier),
    evaluateContinuity: async ({ qualityTier }) => { failingCalls += 1; return continuityResult(qualityTier, true); } });
  const failingEvaluator = new VisualQualityEvaluator({ frameSampler: evaluator.frameSampler, semanticAdapter: failingAdapter });
  const acceptedFirst = await failingEvaluator.evaluate({ media: media('video-1', 'prod-fail'), creativePlan,
    qualityTier: 'STANDARD', expectedAspectRatio: '9:16' });
  assert.notEqual(acceptedFirst.status, 'FAIL');
  const rejectedSecond = await failingEvaluator.evaluate({ media: media('video-2', 'prod-fail'), creativePlan,
    qualityTier: 'STANDARD', expectedAspectRatio: '9:16' });
  assert.equal(rejectedSecond.status, 'FAIL');
  assert.equal(rejectedSecond.disposition, 'BLOCK');
  assert.equal(failingCalls, 1);
  assert(rejectedSecond.checks.some((check) => check.code === REASON_CODES.HUMAN_VISUAL_INTEGRITY && check.status === 'PASS'),
    'within-shot human integrity may pass');
  assert(rejectedSecond.checks.some((check) => check.code === REASON_CODES.CHARACTER_IDENTITY_DRIFT && check.status === 'FAIL'),
    'cross-shot identity drift must independently block the shot');
  assert(rejectedSecond.hardFailureCodes.includes(REASON_CODES.CHARACTER_IDENTITY_DRIFT));

  const beforeHardBlockCalls = failingCalls;
  const hardBlocked = await failingEvaluator.evaluate({ media: media('video-3', 'prod-fail', 1280, 720), creativePlan,
    qualityTier: 'STANDARD', expectedAspectRatio: '9:16' });
  assert.equal(hardBlocked.status, 'FAIL');
  assert.equal(hardBlocked.semantic.metadata.skipReason, REASON_CODES.NOT_EVALUATED_DUE_TO_DETERMINISTIC_BLOCK);
  assert.equal(failingCalls, beforeHardBlockCalls, 'deterministic hard block must not spend continuity evaluation');
}

function accountingTests() {
  const operational = { configured: true, paidExecutionAuthorized: true,
    estimatedCallsPerEvaluation: 1, estimatedContinuityCalls: 1 };
  const plan = semanticEvaluationPlan({ qualityTier: 'STANDARD', videoCount: 3, semanticAdapter: operational });
  assert.equal(plan.sourceEvaluations, 3);
  assert.equal(plan.continuityEvaluations, 2);
  assert.equal(plan.expectedSemanticCalls, 3);
  assert.equal(plan.expectedContinuityCalls, 2);
  assert.equal(plan.expectedExternalCalls, 5);

  const continuity = continuityResult('STANDARD', true);
  const sourceQuality = qualityResult({ qualityClass: 'SOURCE_QUALITY', tier: 'STANDARD', checks: continuity.checks });
  const sourceWithShots = Object.freeze({ ...sourceQuality, shots: Object.freeze([
    Object.freeze({ semantic: sourcePass('STANDARD') }), Object.freeze({ semantic: sourcePass('STANDARD'), continuity })
  ]), semantic: sourcePass('STANDARD') });
  const productionQuality = buildProductionQuality({ tier: 'STANDARD',
    preExecution: qualityResult({ qualityClass: 'PRE', tier: 'STANDARD', checks: [] }), sourceQuality: sourceWithShots });
  assert.equal(productionQuality.metadata.externalCallAccounting.continuityEvaluations, 1,
    'early continuity failure must remain visible in durable external-call accounting');
}

async function recoveryRoutingTests() {
  const continuity = continuityResult('STANDARD', true);
  const candidate = Object.freeze({ assetId: 'video-2', status: 'FAIL', sourceProbe: { width: 720, height: 1280 },
    deterministicVisual: { status: 'PASS', checks: [] }, temporal: { status: 'PASS', checks: [] },
    semantic: sourcePass('STANDARD'), continuity,
    checks: [...sourcePass('STANDARD').checks, ...continuity.checks] });
  assert.deepEqual(continuityFailures(candidate), [REASON_CODES.CHARACTER_IDENTITY_DRIFT]);
  const production = { id: 'prod-recovery', brandId: 'brand-1', jobStatus: 'FAILED',
    jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', details: { sourceQuality: { shots: [candidate] } } },
    jobPayload: { canonicalRawInput: { aspect_ratio: '9:16', scenes: [{ shots: [{ shot_id: 'shot-2', asset_id: 'video-2' }] }] } } };
  const service = new QualityRecoveryService({ repository: { async executionSafety() { return { ambiguousExecutions: 0 }; } },
    storage: {}, commandService: {}, semanticAdapterFactory: () => { throw new Error('continuity drift must not instantiate semantic-only recovery'); } });
  const plan = await service.inspect({ productionId: production.id, brandId: production.brandId, production });
  assert.equal(plan.action, 'REGENERATE_SHOT');
  assert.equal(plan.recoveryKind, 'SOURCE_CONTINUITY');
  assert.equal(plan.operatorAuthorizationRequiredForEveryContinuityReplacement, true);
  assert.equal(plan.automaticContinuityAttemptsMaximum, 0, 'no automatic paid continuity retry loop is permitted');
}

function callerOrderingContractTest() {
  const worker = fs.readFileSync(require.resolve('../worker/v2.1-master-production'), 'utf8');
  const failureGate = worker.indexOf("if (persisted.status === 'FAIL')");
  const nextAssetAdvance = worker.indexOf('mediaResults.push(media);', failureGate);
  assert(failureGate >= 0 && nextAssetAdvance > failureGate,
    'MasterProductionOrchestrator must stop on failed source evaluation before advancing to the next asset');
}

async function main() {
  await geometryPolicyTests();
  await continuityGateTests();
  accountingTests();
  await recoveryRoutingTests();
  callerOrderingContractTest();
  console.log('V2.10.3 cross-shot continuity gate tests passed; real external calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
