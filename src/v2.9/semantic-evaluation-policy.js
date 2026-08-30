'use strict';

const { normalizeTier } = require('./quality-contract');

function semanticEvaluationPlan({ qualityTier = 'STANDARD', videoCount = 0, masterVisualTransforms = false,
  semanticAdapter = null } = {}) {
  const tier = normalizeTier(qualityTier);
  const configured = semanticAdapter?.configured === true;
  const authorized = semanticAdapter?.paidExecutionAuthorized === true;
  const operational = configured && authorized;
  const sourceEvaluations = operational ? videoCount : 0;
  // Continuity is an incremental acceptance gate: every dependent shot is compared before the next shot can execute.
  const continuityEvaluations = operational ? Math.max(0, videoCount - 1) : 0;
  const finalRequired = tier === 'PREMIUM' || masterVisualTransforms === true;
  const finalEvaluations = operational && finalRequired ? 1 : 0;
  const semanticEvaluations = sourceEvaluations + finalEvaluations;
  const evaluatorOperations = semanticEvaluations + continuityEvaluations;
  const callsPerEvaluation = semanticAdapter?.estimatedCallsPerEvaluation || 0;
  const continuityCalls = semanticAdapter?.estimatedContinuityCalls || 0;
  const expectedSemanticCalls = semanticEvaluations * callsPerEvaluation;
  const expectedContinuityCalls = continuityEvaluations * continuityCalls;
  return Object.freeze({
    tier, configured, authorized, operational, sourceEvaluations, finalEvaluations, continuityEvaluations,
    semanticEvaluations, evaluatorOperations, expectedSemanticCalls, expectedContinuityCalls,
    expectedExternalCalls: expectedSemanticCalls + expectedContinuityCalls,
    finalRequired,
    finalPolicy: finalRequired ? (tier === 'PREMIUM' ? 'PREMIUM_SOURCE_AND_FINAL' : 'MASTER_VISUAL_TRANSFORM_REQUIRES_FINAL')
      : 'STANDARD_REUSE_SOURCE_EVIDENCE_FOR_UNCHANGED_MASTER',
  });
}

module.exports = { semanticEvaluationPlan };
