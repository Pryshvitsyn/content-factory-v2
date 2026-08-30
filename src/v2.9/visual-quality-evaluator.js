'use strict';

const { combineResults, normalizeTier, qualityCheck, qualityResult, REASON_CODES } = require('./quality-contract');
const { deterministicTemporalChecks, deterministicVisualChecks } = require('./deterministic-visual-evaluator');
const { DisabledSemanticVisualEvaluatorAdapter } = require('./semantic-visual-evaluator');
const { FfmpegFrameSampler } = require('./frame-sampler');
const { reconcileVisualEvidence, RECONCILIATION_VERSION } = require('../v2.10.1/quality-evidence-reconciliation');

function effectiveVisualGate({ evaluationClass, tier, deterministicVisual, temporal, semantic, metadata = {} }) {
  const rawResults = [deterministicVisual, temporal, semantic];
  const rawEvaluation = combineResults({ qualityClass: `${evaluationClass}_VISUAL_RAW_EVIDENCE`, tier,
    results: rawResults, metadata: { evaluatorVersion: 'v2.10.1-raw-evidence' } });
  const reconciliation = reconcileVisualEvidence({ deterministic: deterministicVisual, temporal, semantic,
    qualityTier: tier });
  const result = qualityResult({ qualityClass: `${evaluationClass}_VISUAL_GATE`, tier,
    checks: [...rawResults.flatMap((item) => item?.checks || []), ...reconciliation.checks], metadata: {
      ...metadata,
      evaluatorVersion: 'v2.10.1',
      reconciliationVersion: RECONCILIATION_VERSION,
      disposition: reconciliation.disposition,
      rawStatus: rawEvaluation.status,
    } });
  return Object.freeze({ ...result, disposition: reconciliation.disposition, reconciliation, rawEvaluation });
}

function continuitySessionKey(media) {
  if (!media?.productionId || !media?.brandId) return null;
  return `${media.brandId}:${media.productionId}`;
}

function shotForMedia(creativePlan, media) {
  const shots = Array.isArray(creativePlan?.shots) ? creativePlan.shots : [];
  const index = shots.findIndex((shot) => String(shot.assetId) === String(media?.assetId));
  return index < 0 ? null : Object.freeze({ index, shot: shots[index], shots });
}

function continuityEntry({ media, shot, evaluation }) {
  return Object.freeze({
    shotId: shot?.shotId || null,
    assetId: media?.assetId || shot?.assetId || null,
    artifactId: media?.artifact?.artifactId || null,
    artifactVersion: media?.artifact?.version || null,
    artifactContentHash: media?.artifact?.contentHash || null,
    evaluation,
  });
}

function continuityFailure({ tier, code, reason, metadata = {} }) {
  return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier, checks: [qualityCheck({
    code, status: 'FAIL', qualityClass: 'CONTINUITY_QUALITY', reason,
  })], metadata: { evaluatorVersion: 'v2.10.3-incremental-gate', externalCalls: 0,
    evaluationType: 'continuity_evaluation', ...metadata } });
}

function aggregateEmbeddedContinuity({ shotEvaluations, tier }) {
  const embedded = shotEvaluations.map((entry) => entry?.evaluation?.continuity)
    .filter((result) => result?.metadata?.incrementalGate === true);
  const required = Math.max(0, shotEvaluations.length - 1);
  if (embedded.length < required) return null;
  const externalCalls = embedded.reduce((sum, result) => sum + Number(result.metadata?.externalCalls || 0), 0);
  return combineResults({ qualityClass: 'CONTINUITY_QUALITY', tier, results: embedded, metadata: {
    evaluatorVersion: 'v2.10.3-incremental-gate', evaluationType: 'continuity_evaluation',
    externalCalls, attempts: externalCalls, incrementalGate: true, aggregateReuse: true,
    shotCount: shotEvaluations.length,
    comparedShots: shotEvaluations.map((entry) => ({ shotId: entry?.shotId || null, assetId: entry?.assetId || null,
      artifactId: entry?.artifactId || null, artifactVersion: entry?.artifactVersion || null,
      artifactContentHash: entry?.artifactContentHash || null })),
  } });
}

class VisualQualityEvaluator {
  constructor({ frameSampler = new FfmpegFrameSampler(), semanticAdapter = new DisabledSemanticVisualEvaluatorAdapter() } = {}) {
    this.frameSampler = frameSampler;
    this.semanticAdapter = semanticAdapter;
    this.continuitySessions = new Map();
  }

  async applyIncrementalContinuityGate({ evaluation, media, creativePlan, tier, evaluationClass }) {
    if (evaluationClass !== 'SOURCE') return evaluation;
    const context = shotForMedia(creativePlan, media);
    const key = continuitySessionKey(media);
    if (!context || context.shots.length <= 1 || !key) return evaluation;

    if (context.index === 0) {
      if (evaluation.status === 'FAIL') this.continuitySessions.delete(key);
      else this.continuitySessions.set(key, Object.freeze({ nextIndex: 1,
        entries: Object.freeze([continuityEntry({ media, shot: context.shot, evaluation })]) }));
      return evaluation;
    }

    if (evaluation.status === 'FAIL') return evaluation;
    const session = this.continuitySessions.get(key);
    if (!session || session.nextIndex !== context.index || session.entries.length !== context.index) {
      const continuity = continuityFailure({ tier, code: REASON_CODES.CONTINUITY_PREDECESSOR_EVIDENCE_MISSING,
        reason: `Shot ${context.shot.shotId || context.index + 1} cannot be accepted because its previously accepted continuity chain is missing.`,
        metadata: { incrementalGate: true, shotIndex: context.index, productionId: media.productionId } });
      const gated = qualityResult({ qualityClass: evaluation.qualityClass, tier,
        checks: [...evaluation.checks, ...continuity.checks], metadata: { ...evaluation.metadata,
          continuityExternalCalls: 0, continuityGate: 'BLOCK', incrementalContinuity: true } });
      return Object.freeze({ ...evaluation, ...gated, disposition: 'BLOCK', continuity });
    }

    const current = continuityEntry({ media, shot: context.shot, evaluation });
    let continuity;
    try {
      continuity = await this.semanticAdapter.evaluateContinuity({
        shotEvaluations: [...session.entries, current], creativePlan, qualityTier: tier,
        evaluationClass: 'CONTINUITY',
      });
    } catch (error) {
      continuity = continuityFailure({ tier, code: REASON_CODES.CONTINUITY_FAILURE,
        reason: `Cross-shot continuity evaluator failed closed: ${error.message}`,
        metadata: { incrementalGate: true, shotIndex: context.index, productionId: media.productionId } });
    }
    continuity = Object.freeze({ ...continuity, metadata: Object.freeze({ ...(continuity.metadata || {}),
      incrementalGate: true, shotIndex: context.index, currentShotId: context.shot.shotId || null,
      currentAssetId: media.assetId || null, productionId: media.productionId,
      comparedArtifactVersions: [...session.entries, current].map((entry) => ({
        shotId: entry.shotId, assetId: entry.assetId, artifactId: entry.artifactId,
        artifactVersion: entry.artifactVersion, artifactContentHash: entry.artifactContentHash,
      })),
    }) });
    const gated = qualityResult({ qualityClass: evaluation.qualityClass, tier,
      checks: [...evaluation.checks, ...continuity.checks], metadata: { ...evaluation.metadata,
        continuityExternalCalls: Number(continuity.metadata?.externalCalls || 0),
        continuityGate: continuity.status === 'FAIL' ? 'BLOCK' : continuity.status,
        incrementalContinuity: true } });
    const result = Object.freeze({ ...evaluation, ...gated,
      disposition: continuity.status === 'FAIL' ? 'BLOCK' : evaluation.disposition,
      continuity });
    if (result.status !== 'FAIL') {
      const entries = Object.freeze([...session.entries, continuityEntry({ media, shot: context.shot, evaluation: result })]);
      this.continuitySessions.set(key, Object.freeze({ nextIndex: context.index + 1, entries }));
    }
    return result;
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
    const semanticRequested = semanticEvaluationRequired !== false;
    const deterministicBlock = deterministicVisual.hardFailure === true;
    const semanticRequired = semanticRequested && !deterministicBlock;
    const semantic = deterministicBlock
      ? qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier, checks: [qualityCheck({
        code: REASON_CODES.NOT_EVALUATED_DUE_TO_DETERMINISTIC_BLOCK, status: 'PASS',
        qualityClass: 'SEMANTIC_VISUAL', hardFailure: false,
        reason: 'Paid semantic evaluation was skipped because deterministic source evidence already contains a non-negotiable technical block.',
      })], metadata: { configured: this.semanticAdapter.configured === true, evaluated: false,
        skipped: true, skipReason: REASON_CODES.NOT_EVALUATED_DUE_TO_DETERMINISTIC_BLOCK,
        provider: this.semanticAdapter.provider, model: this.semanticAdapter.model, externalCalls: 0,
        evaluationType: 'semantic_visual_evaluation' } })
      : semanticRequired
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
      semanticEvaluationRequired: semanticRequired, semanticEvaluationRequested: semanticRequested,
      semanticSkippedDueToDeterministicBlock: deterministicBlock,
    } });
    const base = Object.freeze({ ...result, deterministicVisual, temporal, semantic,
      sampledFrames: Object.freeze(frames) });
    return this.applyIncrementalContinuityGate({ evaluation: base, media, creativePlan, tier, evaluationClass });
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
    const tier = normalizeTier(qualityTier);
    const embedded = aggregateEmbeddedContinuity({ shotEvaluations, tier });
    if (embedded) return embedded;
    return this.semanticAdapter.evaluateContinuity({ shotEvaluations, creativePlan,
      qualityTier: tier, evaluationClass: 'CONTINUITY' });
  }
}

module.exports = { VisualQualityEvaluator, aggregateEmbeddedContinuity, continuityEntry,
  continuitySessionKey, effectiveVisualGate, shotForMedia };
