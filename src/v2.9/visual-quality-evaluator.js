'use strict';

const { combineResults, normalizeTier } = require('./quality-contract');
const { deterministicTemporalChecks, deterministicVisualChecks } = require('./deterministic-visual-evaluator');
const { DisabledSemanticVisualEvaluatorAdapter } = require('./semantic-visual-evaluator');
const { FfmpegFrameSampler } = require('./frame-sampler');

class VisualQualityEvaluator {
  constructor({ frameSampler = new FfmpegFrameSampler(), semanticAdapter = new DisabledSemanticVisualEvaluatorAdapter() } = {}) {
    this.frameSampler = frameSampler;
    this.semanticAdapter = semanticAdapter;
  }

  async evaluate({ media, creativePlan = null, negativeIntent = null, expectedAspectRatio = '9:16',
    intendedContentType = 'cinematic', qualityTier = 'STANDARD', provider = null, model = null,
    generationSettings = {}, motionExpected = true, evaluationClass = 'SOURCE' } = {}) {
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
    const semantic = await this.semanticAdapter.evaluate({ frames: semanticFrames, creativePlan, negativeIntent,
      expectedAspectRatio, intendedContentType, qualityTier: tier, provider, model, generationSettings,
      evaluationClass });
    const result = combineResults({ qualityClass: `${evaluationClass}_VISUAL_GATE`, tier,
      results: [deterministicVisual, temporal, semantic], metadata: {
        evaluatorVersion: 'v2.9', provider, model, generationSettings,
        semanticProvider: this.semanticAdapter.provider, semanticModel: this.semanticAdapter.model,
        semanticExternalCalls: this.semanticAdapter.estimatedCallsPerEvaluation,
      } });
    return Object.freeze({ ...result, deterministicVisual, temporal, semantic, sampledFrames: Object.freeze(frames) });
  }

  async evaluateContinuity({ shotEvaluations = [], creativePlan = null, qualityTier = 'STANDARD' } = {}) {
    return this.semanticAdapter.evaluateContinuity({ shotEvaluations, creativePlan,
      qualityTier: normalizeTier(qualityTier), evaluationClass: 'CONTINUITY' });
  }
}

module.exports = { VisualQualityEvaluator };
