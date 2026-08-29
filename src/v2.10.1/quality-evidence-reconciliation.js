'use strict';

const { REASON_CODES, normalizeTier, qualityCheck, qualityResult } = require('../v2.9/quality-contract');

const RECONCILIATION_VERSION = 'v2.10.1';
const DISPOSITIONS = Object.freeze(['ACCEPT', 'REVIEW', 'BLOCK']);

function allChecks(result) {
  return Array.isArray(result?.checks) ? result.checks : [];
}

function semanticCoherence(semantic) {
  const check = allChecks(semantic).find((item) => item.code === REASON_CODES.SINGLE_COHERENT_COMPOSITION
    && item.status === 'PASS');
  return check ? Object.freeze({ present: true, confidence: Number(check.confidence || 0) })
    : Object.freeze({ present: false, confidence: 0 });
}

function reasonCodesFor(result, statuses = ['FAIL', 'WARN']) {
  return allChecks(result).filter((check) => statuses.includes(check.status)).map((check) => check.code);
}

function reconcileVisualEvidence({ deterministic, temporal, semantic, qualityTier = 'STANDARD', policy = {} } = {}) {
  const tier = normalizeTier(qualityTier);
  const coherentThreshold = Number.isFinite(Number(policy.coherentCompositionConfidence))
    ? Number(policy.coherentCompositionConfidence) : 0.95;
  const deterministicFailures = allChecks(deterministic).filter((check) => check.status === 'FAIL');
  const temporalFailures = allChecks(temporal).filter((check) => check.status === 'FAIL');
  const semanticFailures = allChecks(semantic).filter((check) => check.status === 'FAIL');
  const warnings = [...allChecks(deterministic), ...allChecks(temporal), ...allChecks(semantic)]
    .filter((check) => check.status === 'WARN');
  const coherence = semanticCoherence(semantic);

  const hardObjectiveFailure = [...deterministicFailures, ...temporalFailures, ...semanticFailures]
    .some((check) => check.hardFailure === true);
  const anyFailure = deterministicFailures.length > 0 || temporalFailures.length > 0 || semanticFailures.length > 0;
  const transientDivider = allChecks(deterministic)
    .some((check) => check.code === REASON_CODES.TRANSIENT_INTERNAL_DIVIDER && check.status === 'WARN');
  const strongSemanticContradiction = transientDivider && coherence.present && coherence.confidence >= coherentThreshold;

  let disposition;
  let status;
  let reason;

  if (hardObjectiveFailure || anyFailure) {
    disposition = 'BLOCK';
    status = 'FAIL';
    reason = hardObjectiveFailure
      ? 'Objective or persistent source-quality evidence requires blocking this asset.'
      : 'One or more source-quality checks failed and were not eligible for evidence-only review.';
  } else if (warnings.length > 0 || strongSemanticContradiction) {
    disposition = 'REVIEW';
    status = 'WARN';
    reason = strongSemanticContradiction
      ? 'A transient local divider signal conflicts with high-confidence semantic evidence of one coherent composition; preserve the asset and require review.'
      : 'Source media is technically usable but contains non-blocking quality or creative warnings that require review.';
  } else {
    disposition = 'ACCEPT';
    status = 'PASS';
    reason = 'Deterministic, temporal, and semantic evidence contains no blocking or review-level findings.';
  }

  const evidence = Object.freeze({
    disposition,
    deterministicStatus: deterministic?.status || null,
    temporalStatus: temporal?.status || null,
    semanticStatus: semantic?.status || null,
    deterministicReasonCodes: Object.freeze(reasonCodesFor(deterministic)),
    temporalReasonCodes: Object.freeze(reasonCodesFor(temporal)),
    semanticReasonCodes: Object.freeze(reasonCodesFor(semantic)),
    coherentComposition: coherence,
    coherentCompositionThreshold: coherentThreshold,
    transientDivider,
    strongSemanticContradiction,
  });

  const result = qualityResult({ qualityClass: 'VISUAL_EVIDENCE_RECONCILIATION', tier, checks: [qualityCheck({
    code: REASON_CODES.VISUAL_EVIDENCE_RECONCILIATION,
    status,
    qualityClass: 'VISUAL_EVIDENCE_RECONCILIATION',
    hardFailure: disposition === 'BLOCK',
    reason,
    evidence,
  })], metadata: { reconciliationVersion: RECONCILIATION_VERSION, disposition } });

  return Object.freeze({ ...result, disposition, reasons: Object.freeze([reason]), evidence });
}

module.exports = {
  DISPOSITIONS,
  RECONCILIATION_VERSION,
  reconcileVisualEvidence,
  semanticCoherence,
};
