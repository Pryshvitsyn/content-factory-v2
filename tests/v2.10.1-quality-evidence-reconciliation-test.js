'use strict';

const assert = require('node:assert/strict');
const {
  deterministicVisualChecks,
  dividerEvidence,
} = require('../src/v2.9/deterministic-visual-evaluator');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { reconcileVisualEvidence } = require('../src/v2.10.1/quality-evidence-reconciliation');

function ratios(length, groups = []) {
  const result = Array(length).fill(0.12);
  for (const [start, end, strength = 0.94] of groups) {
    for (let i = start; i <= end; i += 1) result[i] = strength;
  }
  return result;
}

function frame(index, { horizontal = [], vertical = [], black = false } = {}) {
  return Object.freeze({
    ratio: [0.02,0.1,0.3,0.5,0.7,0.9,0.98][index],
    timestampMs: index * 700,
    analysisHash: `hash-${index}`,
    metrics: Object.freeze({
      mean: black ? 1 : 72,
      standardDeviation: black ? 0.3 : 24,
      rowDarkRatios: ratios(128, horizontal),
      columnDarkRatios: ratios(72, vertical),
    }),
    differenceFromPrevious: index === 0 ? null : 12,
  });
}

function semantic({ coherent = true, confidence = 0.99, warnCreative = false } = {}) {
  const checks = [qualityCheck({
    code: REASON_CODES.SINGLE_COHERENT_COMPOSITION,
    status: coherent ? 'PASS' : 'FAIL',
    qualityClass: 'SEMANTIC_VISUAL',
    confidence,
    hardFailure: false,
    reason: coherent ? 'One continuous composition.' : 'Composition is not coherent.',
  })];
  if (warnCreative) checks.push(qualityCheck({
    code: REASON_CODES.CREATIVE_PLAN_MISMATCH,
    status: 'WARN',
    qualityClass: 'SEMANTIC_VISUAL',
    confidence: 0.9,
    hardFailure: false,
    reason: 'Opening tension is under-realized.',
  }));
  return qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier: 'STANDARD', checks,
    metadata: { provider: 'openai', model: 'gpt-5.6-luna', externalCalls: 1 } });
}

function temporalPass() {
  return qualityResult({ qualityClass: 'TEMPORAL_QUALITY', tier: 'STANDARD', checks: [qualityCheck({
    code: REASON_CODES.TEMPORAL_FLICKER, status: 'PASS', qualityClass: 'TEMPORAL_QUALITY',
    reason: 'No flicker.', hardFailure: false,
  })] });
}

function deterministic(frames) {
  return deterministicVisualChecks({ frames, probe: { width: 720, height: 1280 },
    expectedAspectRatio: '9:16', qualityTier: 'STANDARD' });
}

function main() {
  // Incident class: a sofa/wall/shadow line exists in one sample only. It is evidence, not proof of split-screen.
  const transientFrames = Array.from({ length: 7 }, (_, index) => frame(index,
    index === 2 ? { horizontal: [[25, 27]] } : {}));
  const transientEvidence = dividerEvidence(transientFrames);
  assert.equal(transientEvidence.classification, 'TRANSIENT_INTERNAL_DIVIDER');
  const transient = deterministic(transientFrames);
  assert.equal(transient.status, 'WARN');
  assert(transient.checks.some((check) => check.code === REASON_CODES.TRANSIENT_INTERNAL_DIVIDER
    && check.status === 'WARN' && check.hardFailure === false));

  const review = reconcileVisualEvidence({ deterministic: transient, temporal: temporalPass(),
    semantic: semantic({ coherent: true, confidence: 0.99, warnCreative: true }), qualityTier: 'STANDARD' });
  assert.equal(review.disposition, 'REVIEW');
  assert.equal(review.status, 'WARN');
  assert.equal(review.evidence.strongSemanticContradiction, true);

  // A stable divider across most samples is a real persistent split and remains blocking even if AI disagrees.
  const splitFrames = Array.from({ length: 7 }, (_, index) => frame(index,
    index < 5 ? { horizontal: [[62, 64]] } : {}));
  const splitEvidence = dividerEvidence(splitFrames);
  assert.equal(splitEvidence.classification, 'PERSISTENT_SPLIT_SCREEN');
  const split = deterministic(splitFrames);
  assert.equal(split.status, 'FAIL');
  assert(split.hardFailureCodes.includes(REASON_CODES.PERSISTENT_SPLIT_SCREEN));
  const splitDecision = reconcileVisualEvidence({ deterministic: split, temporal: temporalPass(),
    semantic: semantic({ coherent: true, confidence: 0.99 }), qualityTier: 'STANDARD' });
  assert.equal(splitDecision.disposition, 'BLOCK');

  // Two persistent dividers form a multi-panel/triptych layout.
  const multiFrames = Array.from({ length: 7 }, (_, index) => frame(index,
    index < 5 ? { horizontal: [[40, 41], [84, 85]] } : {}));
  assert.equal(dividerEvidence(multiFrames).classification, 'PERSISTENT_MULTI_PANEL');
  const multi = deterministic(multiFrames);
  assert.equal(multi.status, 'FAIL');
  assert(multi.checks.some((check) => check.code === REASON_CODES.TRIPTYCH_DETECTED && check.hardFailure));

  // Stable horizontal + vertical dividers form a contact sheet/grid.
  const gridFrames = Array.from({ length: 7 }, (_, index) => frame(index,
    index < 5 ? { horizontal: [[62, 63]], vertical: [[34, 35]] } : {}));
  assert.equal(dividerEvidence(gridFrames).classification, 'CONTACT_SHEET');
  const grid = deterministic(gridFrames);
  assert(grid.checks.some((check) => check.code === REASON_CODES.CONTACT_SHEET_DETECTED && check.hardFailure));

  // Dark outer matte is excluded from internal divider candidate search and handled by border evidence instead.
  const borderFrames = Array.from({ length: 7 }, (_, index) => frame(index,
    { horizontal: [[0, 4], [123, 127]] }));
  assert.equal(dividerEvidence(borderFrames).classification, 'NONE');

  // Semantic evidence may never rescue objective source corruption.
  const blackFrames = Array.from({ length: 7 }, (_, index) => frame(index, { black: index === 3 }));
  const black = deterministic(blackFrames);
  assert(black.checks.some((check) => check.code === REASON_CODES.BLACK_FRAME && check.status === 'FAIL'));
  const blackDecision = reconcileVisualEvidence({ deterministic: black, temporal: temporalPass(),
    semantic: semantic({ coherent: true, confidence: 0.99 }), qualityTier: 'STANDARD' });
  assert.equal(blackDecision.disposition, 'BLOCK');

  console.log('V2.10.1 temporal panel evidence and deterministic/semantic reconciliation certified. Provider calls = 0.');
}

main();
