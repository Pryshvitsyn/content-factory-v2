'use strict';

const { REASON_CODES, qualityCheck, qualityResult, TIER_POLICIES, normalizeTier } = require('./quality-contract');

class SemanticVisualEvaluatorAdapter {
  constructor({ provider = 'unconfigured', model = null, estimatedCallsPerEvaluation = 0,
    estimatedContinuityCalls = 0, configured = false, paidExecutionAuthorized = false,
    configurationStatus = 'NOT_CONFIGURED', configurationErrors = [], enforcementEnabled = true } = {}) {
    this.provider = provider;
    this.model = model;
    this.estimatedCallsPerEvaluation = estimatedCallsPerEvaluation;
    this.estimatedContinuityCalls = estimatedContinuityCalls;
    this.configured = configured;
    this.paidExecutionAuthorized = paidExecutionAuthorized;
    this.configurationStatus = configurationStatus;
    this.configurationErrors = Object.freeze([...configurationErrors]);
    this.enforcementEnabled = enforcementEnabled;
  }
  async evaluate() { throw new Error('SemanticVisualEvaluatorAdapter.evaluate must be implemented'); }
  async evaluateContinuity() { throw new Error('SemanticVisualEvaluatorAdapter.evaluateContinuity must be implemented'); }
}

class DisabledSemanticVisualEvaluatorAdapter extends SemanticVisualEvaluatorAdapter {
  constructor({ provider = 'unconfigured', model = null, reasonCode = REASON_CODES.SEMANTIC_VISUAL_QA_NOT_CONFIGURED,
    reason = null, configurationStatus = 'NOT_CONFIGURED', configurationErrors = [],
    enforcementEnabled = true } = {}) {
    super({ provider, model, estimatedCallsPerEvaluation: 0, configured: false,
      configurationStatus, configurationErrors, enforcementEnabled });
    this.reasonCode = reasonCode;
    this.reason = reason;
  }
  async evaluate({ qualityTier = 'STANDARD' } = {}) {
    const tier = normalizeTier(qualityTier);
    const required = TIER_POLICIES[tier].semanticVisualRequired;
    return qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier, checks: [qualityCheck({
      code: this.reasonCode,
      status: required ? 'FAIL' : 'WARN', qualityClass: 'SEMANTIC_VISUAL', confidence: 1,
      reason: this.reason || (required
        ? `${tier} requires a configured semantic visual evaluator; no visual pass was fabricated.`
        : 'Semantic visual QA is not configured for this draft evaluation.'),
      hardFailure: false,
    })], metadata: { configured: false, externalCalls: 0, provider: this.provider, model: this.model,
      configurationStatus: this.configurationStatus, configurationErrors: this.configurationErrors } });
  }
  async evaluateContinuity({ qualityTier = 'STANDARD', shotEvaluations = [] } = {}) {
    const tier = normalizeTier(qualityTier); const required = TIER_POLICIES[tier].semanticVisualRequired;
    return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier, checks: [qualityCheck({
      code: shotEvaluations.length <= 1 ? 'CONTINUITY_NOT_APPLICABLE' : this.reasonCode,
      status: shotEvaluations.length <= 1 ? 'PASS' : required ? 'FAIL' : 'WARN', qualityClass: 'CONTINUITY_QUALITY',
      reason: shotEvaluations.length <= 1 ? 'Cross-shot continuity is not applicable to a single-shot production.'
        : this.reason || 'Cross-shot continuity requires a configured semantic evaluator; no continuity pass was fabricated.',
      hardFailure: false,
    })], metadata: { configured: false, externalCalls: 0, shotCount: shotEvaluations.length,
      provider: this.provider, model: this.model, configurationStatus: this.configurationStatus,
      configurationErrors: this.configurationErrors, evaluationType: 'continuity_evaluation' } });
  }
}

class FunctionSemanticVisualEvaluatorAdapter extends SemanticVisualEvaluatorAdapter {
  constructor({ provider, model, evaluate, evaluateContinuity = null, estimatedCallsPerEvaluation = 1,
    estimatedContinuityCalls = evaluateContinuity ? 1 : 0 } = {}) {
    super({ provider, model, estimatedCallsPerEvaluation, estimatedContinuityCalls, configured: true,
      paidExecutionAuthorized: true, configurationStatus: 'CONFIGURED' });
    if (typeof evaluate !== 'function') throw new Error('evaluate function is required');
    this.evaluateFunction = evaluate;
    this.continuityFunction = evaluateContinuity;
  }
  async evaluate(input) {
    const result = await this.evaluateFunction(input);
    if (!result || !['PASS', 'WARN', 'FAIL'].includes(result.status) || !Array.isArray(result.checks)) {
      throw new Error('Semantic evaluator returned an invalid structured quality result');
    }
    return Object.freeze({ ...result, metadata: Object.freeze({ ...(result.metadata || {}), configured: true,
      provider: this.provider, model: this.model }) });
  }
  async evaluateContinuity(input = {}) {
    const tier = normalizeTier(input.qualityTier); const shots = input.shotEvaluations || [];
    if (shots.length <= 1) return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier, checks: [qualityCheck({
      code: 'CONTINUITY_NOT_APPLICABLE', status: 'PASS', qualityClass: 'CONTINUITY_QUALITY',
      reason: 'Cross-shot continuity is not applicable to a single-shot production.', hardFailure: false,
    })], metadata: { configured: true, externalCalls: 0, shotCount: shots.length } });
    if (typeof this.continuityFunction !== 'function') return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier,
      checks: [qualityCheck({ code: REASON_CODES.CONTINUITY_FAILURE, status: tier === 'ECONOMY' ? 'WARN' : 'FAIL',
        qualityClass: 'CONTINUITY_QUALITY', reason: 'The configured semantic adapter does not implement cross-shot continuity evaluation.',
        hardFailure: false })], metadata: { configured: true, externalCalls: 0, shotCount: shots.length } });
    const result = await this.continuityFunction(input);
    if (!result || !['PASS','WARN','FAIL'].includes(result.status) || !Array.isArray(result.checks)) {
      throw new Error('Continuity evaluator returned an invalid structured quality result');
    }
    return Object.freeze({ ...result, metadata: Object.freeze({ ...(result.metadata || {}), configured: true,
      provider: this.provider, model: this.model, shotCount: shots.length }) });
  }
}

module.exports = {
  DisabledSemanticVisualEvaluatorAdapter,
  FunctionSemanticVisualEvaluatorAdapter,
  SemanticVisualEvaluatorAdapter,
};
