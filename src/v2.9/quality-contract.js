'use strict';

const QUALITY_STATUSES = Object.freeze(['PASS', 'WARN', 'FAIL']);
const QUALITY_TIERS = Object.freeze(['ECONOMY', 'STANDARD', 'PREMIUM']);

const REASON_CODES = Object.freeze({
  MULTI_PANEL_COMPOSITION: 'MULTI_PANEL_COMPOSITION',
  TRIPTYCH_DETECTED: 'TRIPTYCH_DETECTED',
  SPLIT_SCREEN_DETECTED: 'SPLIT_SCREEN_DETECTED',
  CONTACT_SHEET_DETECTED: 'CONTACT_SHEET_DETECTED',
  PICTURE_IN_PICTURE_UNEXPECTED: 'PICTURE_IN_PICTURE_UNEXPECTED',
  UNEXPECTED_GENERATED_TEXT: 'UNEXPECTED_GENERATED_TEXT',
  PSEUDO_TEXT_ARTIFACT: 'PSEUDO_TEXT_ARTIFACT',
  SUBJECT_MISMATCH: 'SUBJECT_MISMATCH',
  SEVERE_FACE_DEFORMATION: 'SEVERE_FACE_DEFORMATION',
  SEVERE_ANATOMY_DEFORMATION: 'SEVERE_ANATOMY_DEFORMATION',
  TEMPORAL_FLICKER: 'TEMPORAL_FLICKER',
  IDENTITY_DRIFT: 'IDENTITY_DRIFT',
  OBJECT_DISAPPEARANCE: 'OBJECT_DISAPPEARANCE',
  FRAME_CORRUPTION: 'FRAME_CORRUPTION',
  BLANK_FRAME: 'BLANK_FRAME',
  BLACK_FRAME: 'BLACK_FRAME',
  LARGE_UNINTENDED_BORDER: 'LARGE_UNINTENDED_BORDER',
  EXCESSIVE_STATIC_CONTENT: 'EXCESSIVE_STATIC_CONTENT',
  CONTINUITY_FAILURE: 'CONTINUITY_FAILURE',
  CREATIVE_PLAN_MISMATCH: 'CREATIVE_PLAN_MISMATCH',
  SOURCE_RESOLUTION_BELOW_POLICY: 'SOURCE_RESOLUTION_BELOW_POLICY',
  WRONG_ORIENTATION: 'WRONG_ORIENTATION',
  SEMANTIC_VISUAL_QA_NOT_CONFIGURED: 'SEMANTIC_VISUAL_QA_NOT_CONFIGURED',
  AUDIO_SEMANTIC_QA_NOT_CONFIGURED: 'AUDIO_SEMANTIC_QA_NOT_CONFIGURED',
  REQUIRED_AUDIO_MISSING: 'REQUIRED_AUDIO_MISSING',
  SPEECH_DURATION_MISMATCH: 'SPEECH_DURATION_MISMATCH',
  VOICEOVER_CUTOFF: 'VOICEOVER_CUTOFF',
  EDITORIAL_DEAD_TIME: 'EDITORIAL_DEAD_TIME',
  DUPLICATE_SHOT_UNEXPECTED: 'DUPLICATE_SHOT_UNEXPECTED',
});

const HARD_FAILURE_CODES = new Set([
  REASON_CODES.TRIPTYCH_DETECTED,
  REASON_CODES.MULTI_PANEL_COMPOSITION,
  REASON_CODES.CONTACT_SHEET_DETECTED,
  REASON_CODES.UNEXPECTED_GENERATED_TEXT,
  REASON_CODES.PSEUDO_TEXT_ARTIFACT,
  REASON_CODES.SEVERE_FACE_DEFORMATION,
  REASON_CODES.SEVERE_ANATOMY_DEFORMATION,
  REASON_CODES.SUBJECT_MISMATCH,
  REASON_CODES.FRAME_CORRUPTION,
  REASON_CODES.BLANK_FRAME,
  REASON_CODES.BLACK_FRAME,
  REASON_CODES.WRONG_ORIENTATION,
  REASON_CODES.REQUIRED_AUDIO_MISSING,
  REASON_CODES.VOICEOVER_CUTOFF,
]);

const TIER_POLICIES = Object.freeze({
  ECONOMY: Object.freeze({
    label: 'ECONOMY / DRAFT', purpose: 'Ideation, previews, and internal exploration',
    minimumShortEdge: 480, semanticVisualRequired: false, sampleRatios: [0.02, 0.10, 0.30, 0.50, 0.70, 0.90, 0.98],
    blankStandardDeviation: 1.5, blackMean: 6, staticMeanDifference: 0.8,
  }),
  STANDARD: Object.freeze({
    label: 'STANDARD', purpose: 'Normal commercial and social production',
    minimumShortEdge: 720, semanticVisualRequired: true, sampleRatios: [0.02, 0.10, 0.30, 0.50, 0.70, 0.90, 0.98],
    blankStandardDeviation: 2, blackMean: 8, staticMeanDifference: 1.2,
  }),
  PREMIUM: Object.freeze({
    label: 'PREMIUM', purpose: 'Hero, luxury, and brand-defining production',
    minimumShortEdge: 1080, semanticVisualRequired: true, sampleRatios: [0.01, 0.05, 0.15, 0.30, 0.50, 0.70, 0.85, 0.95, 0.99],
    blankStandardDeviation: 2.5, blackMean: 10, staticMeanDifference: 1.5,
  }),
});

function normalizeTier(value) {
  const tier = String(value || 'STANDARD').toUpperCase();
  if (!QUALITY_TIERS.includes(tier)) throw new Error(`Unsupported quality tier ${value}`);
  return tier;
}

function qualityCheck({ code, status, qualityClass, reason, confidence = 1, score = null,
  evidence = null, hardFailure = null } = {}) {
  if (!code || !QUALITY_STATUSES.includes(status) || !qualityClass || !reason) {
    throw new Error('Quality checks require code, PASS/WARN/FAIL status, qualityClass, and reason');
  }
  const normalizedConfidence = Math.max(0, Math.min(1, Number(confidence)));
  const resolvedScore = score == null ? ({ PASS: 1, WARN: 0.6, FAIL: 0 }[status]) : Math.max(0, Math.min(1, Number(score)));
  return Object.freeze({
    code, status, qualityClass, confidence: normalizedConfidence, score: resolvedScore, reason,
    hardFailure: hardFailure == null ? HARD_FAILURE_CODES.has(code) && status === 'FAIL' : hardFailure === true,
    evidence: evidence ? Object.freeze(structuredClone(evidence)) : null,
  });
}

function qualityResult({ qualityClass, tier = 'STANDARD', checks = [], metadata = {} } = {}) {
  const normalizedTier = normalizeTier(tier);
  const failures = checks.filter((check) => check.status === 'FAIL');
  const warnings = checks.filter((check) => check.status === 'WARN');
  const hardFailures = failures.filter((check) => check.hardFailure).map((check) => check.code);
  const status = failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS';
  const score = checks.length ? Number(Math.min(...checks.map((check) => Number.isFinite(check.score)
    ? check.score : ({ PASS: 1, WARN: 0.6, FAIL: 0 }[check.status] ?? 0))).toFixed(3)) : null;
  return Object.freeze({
    schemaVersion: '2.9', qualityClass, tier: normalizedTier, status, score,
    scoringModel: 'WEAKEST_LINK', hardFailure: hardFailures.length > 0,
    hardFailureCodes: Object.freeze([...new Set(hardFailures)]), checks: Object.freeze([...checks]),
    metadata: Object.freeze(structuredClone(metadata)),
  });
}

function combineResults({ qualityClass, tier = 'STANDARD', results = [], metadata = {} } = {}) {
  return Object.freeze({
    ...qualityResult({ qualityClass, tier, checks: results.flatMap((result) => result?.checks || []), metadata }),
    results: Object.freeze(results.filter(Boolean)),
  });
}

module.exports = {
  HARD_FAILURE_CODES,
  QUALITY_STATUSES,
  QUALITY_TIERS,
  REASON_CODES,
  TIER_POLICIES,
  combineResults,
  normalizeTier,
  qualityCheck,
  qualityResult,
};
