'use strict';

const crypto = require('node:crypto');
const { REASON_CODES } = require('./quality-contract');

const RETRYABLE_SEMANTIC_CODES = Object.freeze(new Set([
  REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE,
  REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_HTTP_FAILED,
  REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_NETWORK_FAILED,
  REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_TIMEOUT,
  REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_RATE_LIMITED,
]));

class SemanticRetryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SemanticRetryError';
    this.code = code;
    this.details = details;
  }
}

function retryPlan(production, input = null) {
  const sourceQuality = production?.jobError?.details?.sourceQuality
    || production?.jobError?.details?.quality?.sourceQuality || null;
  const shots = sourceQuality?.shots || [];
  const failed = shots.filter((shot) => shot.status === 'FAIL');
  const candidate = failed.length === 1 ? failed[0] : null;
  const semanticFailures = candidate?.semantic?.checks?.filter((check) => check.status === 'FAIL') || [];
  const videoAssets = input?.assetPlan?.assets?.filter((asset) => asset.kind === 'video') || [];
  const framesSafe = candidate?.sampledFrames?.length > 0 && candidate.sampledFrames.every((frame) => (
    frame.storageKey && frame.contentHash && frame.analysisHash && Number.isInteger(frame.timestampMs)
  ));
  const eligible = production?.jobError?.code === 'SOURCE_QUALITY_VALIDATION_FAILED'
    && candidate?.deterministicVisual?.status === 'PASS' && candidate?.temporal?.status === 'PASS'
    && semanticFailures.length > 0 && semanticFailures.every((check) => RETRYABLE_SEMANTIC_CODES.has(check.code))
    && framesSafe && (!input || (videoAssets.length === 1 && input.captions?.enabled !== true));
  return Object.freeze({
    eligible,
    action: eligible ? 'RETRY_SEMANTIC_EVALUATION' : null,
    assetId: candidate?.assetId || null,
    reasonCodes: semanticFailures.map((check) => check.code),
    expectedVideoGenerations: 0,
    expectedSpeechGenerations: 0,
    expectedSemanticEvaluations: eligible ? 1 : 0,
    expectedExternalCalls: eligible ? 1 : 0,
    previousEvidenceArtifact: candidate?.evidenceArtifact || null,
    previousEvaluation: candidate,
  });
}

class PostgresSemanticEvaluationAttemptRepository {
  constructor({ db } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    this.db = db;
  }

  async inspectSchema() {
    const result = await this.db.query("SELECT to_regclass('v2_9.semantic_evaluation_attempts') IS NOT NULL AS ready");
    if (!result.rows[0]?.ready) throw new SemanticRetryError('V292_SCHEMA_MISSING', 'V2.9.2 semantic retry migration is required');
    return { ready: true };
  }

  async start({ workspaceId, brandId, productionId, jobId, assetId, sourceArtifact, previousEvidence, evaluator }) {
    const result = await this.db.query(`/* v2.9.2:start-semantic-retry */
      INSERT INTO v2_9.semantic_evaluation_attempts
        (workspace_id,brand_id,production_id,job_id,asset_id,attempt,status,source_artifact,previous_evidence,evaluator_provider,evaluator_model)
      SELECT $1,$2,$3,$4,$5,coalesce(max(attempt),0)+1,'RUNNING',$6::jsonb,$7::jsonb,$8,$9
      FROM v2_9.semantic_evaluation_attempts WHERE production_id=$3 AND asset_id=$5 RETURNING *`,
    [workspaceId, brandId, productionId, jobId, assetId, JSON.stringify(sourceArtifact),
      JSON.stringify(previousEvidence), evaluator.provider, evaluator.model]);
    return result.rows[0];
  }

  async finish({ id, status, resultEvidence = null, error = null, actualSemanticCalls = 1 }) {
    const result = await this.db.query(`/* v2.9.2:finish-semantic-retry */
      UPDATE v2_9.semantic_evaluation_attempts SET status=$2,result_evidence=$3::jsonb,error=$4::jsonb,
        actual_semantic_calls=$5,completed_at=now(),updated_at=now() WHERE id=$1 AND status='RUNNING' RETURNING *`,
    [id, status, JSON.stringify(resultEvidence), JSON.stringify(error), actualSemanticCalls]);
    if (!result.rows[0]) throw new SemanticRetryError('SEMANTIC_RETRY_ATTEMPT_FENCED', 'Semantic retry attempt is no longer active');
    return result.rows[0];
  }
}

async function loadVerifiedFrames(storage, descriptors) {
  return Promise.all(descriptors.map(async (frame) => {
    const bytes = await storage.get({ key: frame.storageKey });
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== frame.contentHash) throw new SemanticRetryError('SEMANTIC_RETRY_FRAME_HASH_MISMATCH',
      'Stored sampled-frame evidence no longer matches its immutable content hash');
    return Object.freeze({ ...frame, bytes, jpeg: bytes, contentType: 'image/jpeg' });
  }));
}

class SemanticEvaluationRetryService {
  constructor({ repository, storage, mediaExecutor, evaluator, masterOrchestrator } = {}) {
    if (!repository || !storage || !mediaExecutor || !evaluator || !masterOrchestrator) {
      throw new Error('repository, storage, mediaExecutor, evaluator, and masterOrchestrator are required');
    }
    this.repository = repository;
    this.storage = storage;
    this.mediaExecutor = mediaExecutor;
    this.evaluator = evaluator;
    this.masterOrchestrator = masterOrchestrator;
  }

  async execute({ production, input, workerId }) {
    const plan = retryPlan(production, input);
    if (!plan.eligible) throw new SemanticRetryError('SEMANTIC_RETRY_UNAVAILABLE', 'This failure is not eligible for semantic-only retry');
    await this.repository.inspectSchema();
    let attempt;
    let actualSemanticCalls = 0;
    try {
      const frames = await loadVerifiedFrames(this.storage, plan.previousEvaluation.sampledFrames);
      const assets = await Promise.all(input.assetPlan.assets.map((asset) => this.mediaExecutor.loadExisting({
        workspaceId: production.workspaceId, productionId: production.id, brandId: production.brandId, workerId, asset,
      })));
      const sourceMedia = assets.find((item) => item.assetId === plan.assetId);
      attempt = await this.repository.start({ workspaceId: production.workspaceId, brandId: production.brandId,
        productionId: production.id, jobId: production.jobId, assetId: plan.assetId,
        sourceArtifact: sourceMedia.artifact, previousEvidence: plan.previousEvaluation,
        evaluator: this.evaluator.semanticAdapter });
      const asset = input.assetPlan.assets.find((item) => item.asset_id === plan.assetId);
      actualSemanticCalls = 1;
      const evaluation = await this.evaluator.retrySemantic({ priorEvaluation: plan.previousEvaluation, frames,
        creativePlan: input.creativePlan || null, negativeIntent: asset.generation_requirements?.negative_intent || null,
        expectedAspectRatio: asset.generation_requirements?.aspect_ratio || '9:16', qualityTier: asset.generation_requirements?.profile || 'STANDARD',
        provider: sourceMedia.provider, model: sourceMedia.model,
        generationSettings: asset.generation_requirements?.resolved_settings || {} });
      if (evaluation.status !== 'PASS') {
        await this.repository.finish({ id: attempt.id, status: 'FAILED', resultEvidence: evaluation, actualSemanticCalls });
        throw new SemanticRetryError('SEMANTIC_RETRY_FAILED',
          'Semantic retry did not PASS; master assembly remains blocked', { evaluation });
      }
      const result = await this.masterOrchestrator.build({ productionId: production.id, workspaceId: production.workspaceId,
        brandId: production.brandId, workerId, script: input.script, shotPlan: input.shotPlan, assetPlan: input.assetPlan,
        resolvedMedia: assets, qualityPolicy: { requireVoiceForSpokenCopy: input.voiceover?.enabled === true,
          strictApprovedCopy: input.spokenCopyPolicy?.strictApprovedCopy !== false, requireVoiceTimingPlan: true,
          requireProviderCompatibility: true, creativePlan: input.creativePlan || null, masterVisualTransforms: false },
        semanticRecovery: { assetId: plan.assetId, evaluation, previousEvidence: plan.previousEvaluation.evidenceArtifact } });
      await this.repository.finish({ id: attempt.id, status: 'SUCCEEDED', resultEvidence: evaluation, actualSemanticCalls });
      return Object.freeze({ result, attemptId: attempt.id, assetId: plan.assetId,
        videoGenerations: 0, speechGenerations: 0, semanticEvaluations: actualSemanticCalls });
    } catch (error) {
      if (attempt && error.code !== 'SEMANTIC_RETRY_FAILED') await this.repository.finish({ id: attempt.id, status: 'FAILED',
        error: { code: error.code || 'SEMANTIC_RETRY_FAILED', message: error.message }, actualSemanticCalls }).catch(() => {});
      throw error;
    }
  }
}

module.exports = { RETRYABLE_SEMANTIC_CODES, SemanticRetryError, retryPlan,
  PostgresSemanticEvaluationAttemptRepository, SemanticEvaluationRetryService, loadVerifiedFrames };
