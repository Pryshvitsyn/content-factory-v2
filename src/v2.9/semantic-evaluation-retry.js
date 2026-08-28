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
const AMBIGUOUS_MEDIA_STATUSES = Object.freeze(new Set(['MAY_HAVE_STARTED','NEEDS_RECONCILIATION']));

function durableArtifactRecorded(row) {
  return Boolean(row?.status === 'SUCCEEDED' && row.artifact_storage_key && row.artifact_content_hash);
}

function sourceArtifactFromExecution(row) {
  if (!durableArtifactRecorded(row)) return null;
  return Object.freeze({ artifactId: row.artifact_id, version: row.artifact_version,
    storageKey: row.artifact_storage_key, contentHash: row.artifact_content_hash });
}

function artifactIdentityMatches(recorded, current) {
  const keys = ['artifactId','version','storageKey','contentHash'];
  return keys.every((key) => recorded?.[key] !== undefined && recorded?.[key] !== null
    && current?.[key] !== undefined && current?.[key] !== null && recorded[key] === current[key]);
}

function evidenceLineageMatches(recordedPrevious, expectedArtifact) {
  const recorded = recordedPrevious?.evidenceArtifact || recordedPrevious?.evidence_artifact || null;
  const keys = ['artifactId','version','storageKey','contentHash'].filter((key) => expectedArtifact?.[key] !== undefined
    && expectedArtifact?.[key] !== null);
  return keys.length >= 2 && keys.every((key) => recorded?.[key] === expectedArtifact[key]);
}

function validSemanticPass(evidence) {
  const checks = evidence?.semantic?.checks;
  return evidence?.status === 'PASS' && evidence?.semantic?.status === 'PASS'
    && Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.status === 'PASS');
}

function reusableSemanticPass({ attempt, sourceArtifact, previousEvidenceArtifact, evaluator } = {}) {
  const reusable = attempt?.status === 'FAILED' && validSemanticPass(attempt.result_evidence)
    && artifactIdentityMatches(attempt.source_artifact, sourceArtifact)
    && evidenceLineageMatches(attempt.previous_evidence, previousEvidenceArtifact)
    && attempt.evaluator_provider === evaluator?.provider && attempt.evaluator_model === evaluator?.model;
  return Object.freeze({ reusable, attemptId: reusable ? attempt.id : null,
    attempt: reusable ? attempt.attempt : null, evaluation: reusable ? attempt.result_evidence : null });
}

function partialMediaPlan({ input, sourceAssetId, executions = [] } = {}) {
  const byAsset = new Map(executions.map((row) => [String(row.asset_id || row.assetId), row]));
  const assets = input?.assetPlan?.assets || [];
  const source = assets.find((asset) => asset.asset_id === sourceAssetId && asset.kind === 'video');
  const sourceRow = source ? byAsset.get(String(source.asset_id)) : null;
  const voices = assets.filter((asset) => asset.kind === 'voice').map((asset) => {
    const row = byAsset.get(String(asset.asset_id)) || null;
    const state = durableArtifactRecorded(row) ? 'REUSED'
      : AMBIGUOUS_MEDIA_STATUSES.has(row?.status) ? 'AMBIGUOUS'
        : row?.status === 'SUCCEEDED' ? 'ARTIFACT_MISSING'
          : row?.status === 'FAILED' ? 'TERMINAL_FAILED' : 'MISSING';
    return Object.freeze({ assetId: asset.asset_id, state, status: row?.status || null });
  });
  return Object.freeze({
    existingSourceVideo: durableArtifactRecorded(sourceRow),
    sourceVideoState: durableArtifactRecorded(sourceRow) ? 'REUSED' : sourceRow?.status || 'MISSING',
    voices: Object.freeze(voices),
    reusedVideoAssets: durableArtifactRecorded(sourceRow) ? 1 : 0,
    reusedSpeechAssets: voices.filter((voice) => voice.state === 'REUSED').length,
    possiblePostPassSpeechGenerations: voices.filter((voice) => voice.state === 'MISSING').length,
    ambiguousSpeechAssets: voices.filter((voice) => voice.state === 'AMBIGUOUS').map((voice) => voice.assetId),
    blockedSpeechAssets: voices.filter((voice) => ['ARTIFACT_MISSING','TERMINAL_FAILED'].includes(voice.state))
      .map((voice) => voice.assetId),
    newVideoGenerations: 0,
  });
}

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
    const result = await this.db.query(`SELECT
      to_regclass('v2_9.semantic_evaluation_attempts') IS NOT NULL AS ready,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='v2_9'
        AND table_name='semantic_evaluation_attempts' AND column_name='recovery_phase') AS resumable`);
    if (!result.rows[0]?.ready) throw new SemanticRetryError('V292_SCHEMA_MISSING', 'V2.9.2 semantic retry migration is required');
    if (!result.rows[0]?.resumable) throw new SemanticRetryError('V2922_SCHEMA_MISSING',
      'V2.9.2.2 capability-scoped semantic recovery migration is required');
    return { ready: true };
  }

  async latest({ workspaceId, brandId, productionId, assetId }) {
    const result = await this.db.query(`/* v2.9.2.2:latest-semantic-retry */
      SELECT * FROM v2_9.semantic_evaluation_attempts
      WHERE workspace_id=$1 AND brand_id=$2 AND production_id=$3 AND asset_id=$4
      ORDER BY attempt DESC LIMIT 1`, [workspaceId, brandId, productionId, assetId]);
    return result.rows[0] || null;
  }

  async start({ workspaceId, brandId, productionId, jobId, assetId, sourceArtifact, previousEvidence, evaluator,
    mediaPlan = {}, expectedSemanticCalls = 1, reusedSemanticAttemptId = null,
    recoveryPhase = expectedSemanticCalls === 0 ? 'SEMANTIC_PASSED' : 'BEFORE_SEMANTIC' }) {
    const result = await this.db.query(`/* v2.9.2:start-semantic-retry */
      INSERT INTO v2_9.semantic_evaluation_attempts
        (workspace_id,brand_id,production_id,job_id,asset_id,attempt,status,source_artifact,previous_evidence,
         evaluator_provider,evaluator_model,expected_semantic_calls,possible_post_pass_speech_calls,
         reused_video_assets,reused_speech_assets,reused_semantic_attempt_id,recovery_phase)
      SELECT $1,$2,$3,$4,$5,coalesce(max(attempt),0)+1,'RUNNING',$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15
      FROM v2_9.semantic_evaluation_attempts WHERE production_id=$3 AND asset_id=$5 RETURNING *`,
    [workspaceId, brandId, productionId, jobId, assetId, JSON.stringify(sourceArtifact),
      JSON.stringify(previousEvidence), evaluator.provider, evaluator.model, expectedSemanticCalls,
      mediaPlan.possiblePostPassSpeechGenerations || 0, mediaPlan.reusedVideoAssets || 0, 0,
      reusedSemanticAttemptId, recoveryPhase]);
    return result.rows[0];
  }

  async finish({ id, status, resultEvidence = null, error = null, actualSemanticCalls = 1,
    reusedVideoAssets = 1, reusedSpeechAssets = 0, newSpeechGenerations = 0, newVideoGenerations = 0,
    recoveryPhase = status === 'SUCCEEDED' ? 'SUCCEEDED' : 'BEFORE_SEMANTIC' }) {
    const result = await this.db.query(`/* v2.9.2:finish-semantic-retry */
      UPDATE v2_9.semantic_evaluation_attempts SET status=$2,result_evidence=$3::jsonb,error=$4::jsonb,
        actual_semantic_calls=$5,reused_video_assets=$6,reused_speech_assets=$7,new_speech_generations=$8,
        new_video_generations=$9,recovery_phase=$10,completed_at=now(),updated_at=now()
      WHERE id=$1 AND status='RUNNING' RETURNING *`,
    [id, status, JSON.stringify(resultEvidence), JSON.stringify(error), actualSemanticCalls,
      reusedVideoAssets, reusedSpeechAssets, newSpeechGenerations, newVideoGenerations, recoveryPhase]);
    if (!result.rows[0]) throw new SemanticRetryError('SEMANTIC_RETRY_ATTEMPT_FENCED', 'Semantic retry attempt is no longer active');
    return result.rows[0];
  }
}

function semanticFrameDescriptor(frame = {}) {
  const descriptor = {
    ratio: frame.ratio,
    timestampMs: frame.timestampMs,
    analysisHash: frame.analysisHash,
    artifactId: frame.artifactId || frame.artifact_id || null,
    artifactVersion: frame.artifactVersion ?? frame.artifact_version ?? null,
    storageKey: frame.storageKey || frame.storage_key || null,
    contentHash: frame.contentHash || frame.content_hash || null,
    contentType: frame.contentType || frame.content_type || 'image/jpeg',
  };
  if (!descriptor.storageKey || !descriptor.contentHash || !descriptor.analysisHash
    || !Number.isInteger(descriptor.timestampMs)) {
    throw new SemanticRetryError('SEMANTIC_RETRY_FRAME_EVIDENCE_MISSING',
      'Semantic retry requires immutable sampled-frame descriptors before persistence or master continuation');
  }
  return Object.freeze(descriptor);
}

function durableSemanticEvaluation(evaluation) {
  if (!evaluation) return evaluation;
  const sampledFrames = Object.freeze((evaluation.sampledFrames || []).map(semanticFrameDescriptor));
  return Object.freeze({ ...evaluation, sampledFrames });
}

async function loadVerifiedFrames(storage, descriptors) {
  return Promise.all(descriptors.map(async (frame) => {
    const descriptor = semanticFrameDescriptor(frame);
    const bytes = await storage.get({ key: descriptor.storageKey });
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== descriptor.contentHash) throw new SemanticRetryError('SEMANTIC_RETRY_FRAME_HASH_MISMATCH',
      'Stored sampled-frame evidence no longer matches its immutable content hash');
    return Object.freeze({ ...descriptor, bytes, jpeg: bytes, contentType: 'image/jpeg' });
  }));
}

async function materializeEvaluationFrames(storage, evaluation) {
  const durable = durableSemanticEvaluation(evaluation);
  if (!durable?.sampledFrames?.length) {
    throw new SemanticRetryError('SEMANTIC_RETRY_FRAME_EVIDENCE_MISSING',
      'Semantic recovery PASS has no immutable sampled-frame evidence for master continuation');
  }
  const sampledFrames = Object.freeze(await loadVerifiedFrames(storage, durable.sampledFrames));
  return Object.freeze({ ...durable, sampledFrames });
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
    const sourceAsset = input.assetPlan.assets.find((asset) => asset.asset_id === plan.assetId && asset.kind === 'video');
    const executionRepository = this.mediaExecutor.repository;
    if (!sourceAsset || typeof executionRepository?.get !== 'function') {
      throw new SemanticRetryError('SEMANTIC_RETRY_MEDIA_LOOKUP_UNAVAILABLE',
        'Semantic retry cannot verify the exact durable source execution');
    }
    const scopedExecution = (asset) => executionRepository.get({ workspaceId: production.workspaceId,
      brandId: production.brandId, productionId: production.id, assetId: asset.asset_id });
    const plannedAssets = input.assetPlan.assets.filter((asset) => asset.kind === 'video' || asset.kind === 'voice');
    const executions = (await Promise.all(plannedAssets.map(scopedExecution))).filter(Boolean);
    const mediaPlan = partialMediaPlan({ input, sourceAssetId: plan.assetId, executions });
    if (!mediaPlan.existingSourceVideo) throw new SemanticRetryError('SEMANTIC_RETRY_SOURCE_MISSING',
      'Semantic retry requires the exact succeeded immutable source video before any evaluator call', { providerExecutions: 0 });
    let attempt; let attemptFinished = false; let semanticEvaluation = null; let failurePhase = 'BEFORE_SEMANTIC';
    let actualSemanticCalls = 0;
    let reusedSpeechAssets = 0; let newSpeechGenerations = 0;
    try {
      const sourceMedia = await this.mediaExecutor.loadExisting({ workspaceId: production.workspaceId,
        productionId: production.id, brandId: production.brandId, workerId, asset: sourceAsset });
      const latestAttempt = typeof this.repository.latest === 'function' ? await this.repository.latest({
        workspaceId: production.workspaceId, brandId: production.brandId, productionId: production.id,
        assetId: plan.assetId }) : null;
      const reusable = reusableSemanticPass({ attempt: latestAttempt, sourceArtifact: sourceMedia.artifact,
        previousEvidenceArtifact: plan.previousEvidenceArtifact, evaluator: this.evaluator.semanticAdapter });
      attempt = await this.repository.start({ workspaceId: production.workspaceId, brandId: production.brandId,
        productionId: production.id, jobId: production.jobId, assetId: plan.assetId,
        sourceArtifact: sourceMedia.artifact, previousEvidence: plan.previousEvaluation,
        evaluator: this.evaluator.semanticAdapter, mediaPlan, expectedSemanticCalls: reusable.reusable ? 0 : 1,
        reusedSemanticAttemptId: reusable.attemptId,
        recoveryPhase: reusable.reusable ? 'SEMANTIC_PASSED' : 'BEFORE_SEMANTIC' });
      let evaluation = reusable.evaluation;
      if (!reusable.reusable) {
        const frames = await loadVerifiedFrames(this.storage, plan.previousEvaluation.sampledFrames);
        actualSemanticCalls = 1;
        evaluation = await this.evaluator.retrySemantic({ priorEvaluation: plan.previousEvaluation, frames,
          creativePlan: input.creativePlan || null, negativeIntent: sourceAsset.generation_requirements?.negative_intent || null,
          expectedAspectRatio: sourceAsset.generation_requirements?.aspect_ratio || '9:16',
          qualityTier: sourceAsset.generation_requirements?.profile || 'STANDARD',
          provider: sourceMedia.provider, model: sourceMedia.model,
          generationSettings: sourceAsset.generation_requirements?.resolved_settings || {} });
      }
      const durableEvaluation = durableSemanticEvaluation(evaluation);
      semanticEvaluation = durableEvaluation;
      if (durableEvaluation.status !== 'PASS') {
        await this.repository.finish({ id: attempt.id, status: 'FAILED', resultEvidence: durableEvaluation,
          actualSemanticCalls, reusedVideoAssets: 1, reusedSpeechAssets: 0,
          newSpeechGenerations: 0, newVideoGenerations: 0, recoveryPhase: 'SEMANTIC_FAILED',
          error: { code: 'SEMANTIC_RETRY_FAILED', message: 'Semantic retry did not PASS',
            recoveryPhase: 'SEMANTIC_FAILED' } });
        attemptFinished = true;
        throw new SemanticRetryError('SEMANTIC_RETRY_FAILED',
          'Semantic retry did not PASS; master assembly remains blocked', { evaluation: durableEvaluation });
      }

      // Materialize and hash-verify the exact persisted frame evidence before any post-PASS paid media call.
      // JSON-round-tripped Buffer objects from older attempts are deliberately ignored; artifact storage is authoritative.
      const masterEvaluation = await materializeEvaluationFrames(this.storage, durableEvaluation);

      failurePhase = 'POST_PASS_MEDIA_FAILED';
      const assets = [sourceMedia];
      for (const asset of input.assetPlan.assets.filter((item) => item.asset_id !== plan.assetId)) {
        try {
          const reused = await this.mediaExecutor.loadExisting({ workspaceId: production.workspaceId,
            productionId: production.id, brandId: production.brandId, workerId, asset });
          assets.push(reused);
          if (asset.kind === 'voice') reusedSpeechAssets += 1;
        } catch (error) {
          if (asset.kind !== 'voice' || error.code !== 'SEMANTIC_RETRY_MEDIA_MISSING') throw error;
          const row = await scopedExecution(asset);
          if (AMBIGUOUS_MEDIA_STATUSES.has(row?.status) || ['SUCCEEDED','FAILED'].includes(row?.status)) {
            throw new SemanticRetryError('SEMANTIC_RETRY_SPEECH_RECONCILIATION_REQUIRED',
              `Speech execution ${asset.asset_id} requires reconciliation; no duplicate call was made`);
          }
          const generated = await this.mediaExecutor.execute({ workspaceId: production.workspaceId,
            productionId: production.id, brandId: production.brandId, workerId, asset });
          assets.push(generated); newSpeechGenerations += 1;
        }
      }
      failurePhase = 'MASTER_FAILED';
      const result = await this.masterOrchestrator.build({ productionId: production.id, workspaceId: production.workspaceId,
        brandId: production.brandId, workerId, script: input.script, shotPlan: input.shotPlan, assetPlan: input.assetPlan,
        resolvedMedia: assets, qualityPolicy: { requireVoiceForSpokenCopy: input.voiceover?.enabled === true,
          strictApprovedCopy: input.spokenCopyPolicy?.strictApprovedCopy !== false, requireVoiceTimingPlan: true,
          requireProviderCompatibility: true, creativePlan: input.creativePlan || null, masterVisualTransforms: false },
        semanticRecovery: { assetId: plan.assetId, evaluation: masterEvaluation,
          previousEvidence: plan.previousEvaluation.evidenceArtifact } });
      await this.repository.finish({ id: attempt.id, status: 'SUCCEEDED', resultEvidence: durableEvaluation,
        actualSemanticCalls, reusedVideoAssets: 1, reusedSpeechAssets,
        newSpeechGenerations, newVideoGenerations: 0, recoveryPhase: 'SUCCEEDED' });
      attemptFinished = true;
      return Object.freeze({ result, attemptId: attempt.id, assetId: plan.assetId,
        reusedVideoAssets: 1, reusedSpeechAssets, semanticEvaluations: actualSemanticCalls,
        reusedSemanticAttemptId: reusable.attemptId, newSpeechGenerations, newVideoGenerations: 0 });
    } catch (error) {
      if (attempt && !attemptFinished) await this.repository.finish({ id: attempt.id, status: 'FAILED',
        resultEvidence: semanticEvaluation,
        error: { code: error.code || 'SEMANTIC_RETRY_FAILED', message: error.message, recoveryPhase: failurePhase }, actualSemanticCalls,
        reusedVideoAssets: 1, reusedSpeechAssets, newSpeechGenerations, newVideoGenerations: 0,
        recoveryPhase: failurePhase }).catch(() => {});
      throw error;
    }
  }
}

module.exports = { AMBIGUOUS_MEDIA_STATUSES, RETRYABLE_SEMANTIC_CODES, SemanticRetryError,
  artifactIdentityMatches, durableArtifactRecorded, durableSemanticEvaluation, evidenceLineageMatches,
  materializeEvaluationFrames, partialMediaPlan, retryPlan, reusableSemanticPass, semanticFrameDescriptor,
  sourceArtifactFromExecution, validSemanticPass,
  PostgresSemanticEvaluationAttemptRepository, SemanticEvaluationRetryService, loadVerifiedFrames };
