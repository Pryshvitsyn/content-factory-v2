'use strict';

const { combineResults, normalizeTier, qualityCheck, qualityResult, REASON_CODES } = require('./quality-contract');
const { deterministicTemporalChecks, deterministicVisualChecks } = require('./deterministic-visual-evaluator');
const { DisabledSemanticVisualEvaluatorAdapter } = require('./semantic-visual-evaluator');
const { FfmpegFrameSampler } = require('./frame-sampler');
const { reconcileVisualEvidence, RECONCILIATION_VERSION } = require('../v2.10.1/quality-evidence-reconciliation');

function effectiveVisualGate({ evaluationClass, tier, deterministicVisual, temporal, semantic, metadata = {} }) {
  const rawEvaluation = combineResults({ qualityClass: `${evaluationClass}_VISUAL_RAW_EVIDENCE`, tier,
    results: [deterministicVisual, temporal, semantic], metadata: { evaluatorVersion: 'v2.10.1-raw-evidence' } });
  const reconciliation = reconcileVisualEvidence({ deterministic: deterministicVisual, temporal, semantic,
    qualityTier: tier });
  const result = qualityResult({ qualityClass: `${evaluationClass}_VISUAL_GATE`, tier,
    checks: reconciliation.checks, metadata: {
      ...metadata,
      evaluatorVersion: 'v2.10.1',
      reconciliationVersion: RECONCILIATION_VERSION,
      disposition: reconciliation.disposition,
      rawStatus: rawEvaluation.status,
    } });
  return Object.freeze({ ...result, disposition: reconciliation.disposition, reconciliation, rawEvaluation });
}

class VisualQualityEvaluator {
  constructor({ frameSampler = new FfmpegFrameSampler(), semanticAdapter = new DisabledSemanticVisualEvaluatorAdapter() } = {}) {
    this.frameSampler = frameSampler;
    this.semanticAdapter = semanticAdapter;
  }

  async evaluate({ media, creativePlan = null, negativeIntent = null, expectedAspectRatio = '9:16',
    intendedContentType = 'cinematic', qualityTier = 'STANDARD', provider = null, model = null,
    generationSettings = {}, motionExpected = true, evaluationClass = 'SOURCE',
    semanticEvaluationRequired = true } = {}) {
    const tier = normalizeTier(qualityTier);
    let frames;
    try {
      frames = await this.frameSampler.sample({ bytes: media.bytes, contentType: media.contentType,
        kind: 'video', durationMs: media.mediaProbe?.durationMs, width: media.mediaProbe?.width,
        height: media.mediaProbe?.height, qualityTier: tier });
    } catch (error) {
      error.code = error.code || 'FRAME_CORRUPTION';
      throw error;
    }
    const deterministicVisual = deterministicVisualChecks({ frames, probe: media.mediaProbe,
      expectedAspectRatio, qualityTier: tier });
    const temporal = deterministicTemporalChecks({ frames, qualityTier: tier, motionExpected });
    const semanticFrames = frames.map((frame) => ({ ratio: frame.ratio, timestampMs: frame.timestampMs,
      contentType: 'image/jpeg', bytes: frame.jpeg, analysisHash: frame.analysisHash }));
    const semanticRequired = semanticEvaluationRequired !== false;
    const semantic = semanticRequired
      ? await this.semanticAdapter.evaluate({ frames: semanticFrames, creativePlan, negativeIntent,
        expectedAspectRatio, intendedContentType, qualityTier: tier, provider, model, generationSettings,
        evaluationClass })
      : qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier, checks: [qualityCheck({
        code: REASON_CODES.SEMANTIC_VISUAL_EVALUATION_NOT_REQUIRED, status: 'PASS',
        qualityClass: 'SEMANTIC_VISUAL', hardFailure: false,
        reason: 'Semantic provider evaluation is not required by the source-versus-final cost policy; deterministic final checks still ran.',
      })], metadata: { configured: this.semanticAdapter.configured === true, evaluated: false,
        provider: this.semanticAdapter.provider, model: this.semanticAdapter.model, externalCalls: 0,
        evaluationType: 'semantic_visual_evaluation' } });
    const result = effectiveVisualGate({ evaluationClass, tier, deterministicVisual, temporal, semantic, metadata: {
      provider, model, generationSettings,
      semanticProvider: this.semanticAdapter.provider, semanticModel: this.semanticAdapter.model,
      semanticExternalCalls: semantic.metadata?.externalCalls || 0,
      semanticEvaluationRequired: semanticRequired,
    } });
    return Object.freeze({ ...result, deterministicVisual, temporal, semantic,
      sampledFrames: Object.freeze(frames) });
  }

  async retrySemantic({ priorEvaluation, frames, creativePlan = null, negativeIntent = null,
    expectedAspectRatio = '9:16', intendedContentType = 'cinematic', qualityTier = 'STANDARD',
    provider = null, model = null, generationSettings = {}, evaluationClass = 'SOURCE' } = {}) {
    const tier = normalizeTier(qualityTier);
    if (priorEvaluation?.deterministicVisual?.status === 'FAIL' || priorEvaluation?.temporal?.status === 'FAIL') {
      const error = new Error('Semantic-only retry requires prior deterministic and temporal evidence without FAIL');
      error.code = 'SEMANTIC_RETRY_PREREQUISITES_FAILED';
      throw error;
    }
    if (!Array.isArray(frames) || frames.length === 0 || frames.some((frame) => !Buffer.isBuffer(frame.bytes || frame.jpeg))) {
      const error = new Error('Semantic-only retry requires the existing immutable sampled-frame bytes');
      error.code = 'SEMANTIC_RETRY_FRAME_EVIDENCE_MISSING';
      throw error;
    }
    const semanticFrames = frames.map((frame) => ({ ratio: frame.ratio, timestampMs: frame.timestampMs,
      contentType: frame.contentType || 'image/jpeg', bytes: frame.bytes || frame.jpeg,
      analysisHash: frame.analysisHash }));
    const semantic = await this.semanticAdapter.evaluate({ frames: semanticFrames, creativePlan, negativeIntent,
      expectedAspectRatio, intendedContentType, qualityTier: tier, provider, model, generationSettings,
      evaluationClass });
    const result = effectiveVisualGate({ evaluationClass, tier,
      deterministicVisual: priorEvaluation.deterministicVisual, temporal: priorEvaluation.temporal, semantic, metadata: {
        provider, model, generationSettings,
        semanticProvider: this.semanticAdapter.provider, semanticModel: this.semanticAdapter.model,
        semanticExternalCalls: semantic.metadata?.externalCalls || 0,
        semanticEvaluationRequired: true, semanticOnlyRetry: true,
      } });
    return Object.freeze({ ...result, deterministicVisual: priorEvaluation.deterministicVisual,
      temporal: priorEvaluation.temporal, semantic, sampledFrames: Object.freeze(frames) });
  }

  async evaluateContinuity({ shotEvaluations = [], creativePlan = null, qualityTier = 'STANDARD' } = {}) {
    return this.semanticAdapter.evaluateContinuity({ shotEvaluations, creativePlan,
      qualityTier: normalizeTier(qualityTier), evaluationClass: 'CONTINUITY' });
  }
}

module.exports = { VisualQualityEvaluator, effectiveVisualGate };
