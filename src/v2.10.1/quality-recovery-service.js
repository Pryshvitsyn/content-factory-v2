'use strict';

const crypto = require('node:crypto');
const { ArtifactService } = require('../artifacts/artifact-service');
const { VisualQualityEvaluator } = require('../v2.9/visual-quality-evaluator');
const { createSemanticVisualEvaluatorAdapter } = require('../v2.9/semantic-visual-evaluator-factory');
const { persistVisualQualityEvidence } = require('../../worker/v2.1-master-production');

const QUALITY_RECOVERY_VERSION = 'v2.10.1';
const RECOVERABLE_ERROR = 'SOURCE_QUALITY_VALIDATION_FAILED';

class QualityRecoveryError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'QualityRecoveryError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sameArray(left = [], right = []) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function candidateFromProduction(production) {
  const sourceQuality = production?.jobError?.details?.sourceQuality || null;
  const shots = Array.isArray(sourceQuality?.shots) ? sourceQuality.shots : [];
  const failed = shots.filter((shot) => shot?.status === 'FAIL');
  if (failed.length !== 1) return null;
  return failed[0];
}

function semanticEvidenceReusable(candidate, env = process.env) {
  const semantic = candidate?.semantic;
  if (!semantic || semantic.status === 'FAIL' || !Array.isArray(semantic.checks) || !semantic.checks.length) return false;
  const frameHashes = (candidate.sampledFrames || []).map((frame) => frame.analysisHash).filter(Boolean);
  const frameTimes = (candidate.sampledFrames || []).map((frame) => frame.timestampMs);
  const metadata = semantic.metadata || {};
  const recordedHashes = metadata.sampledFrameHashes || frameHashes;
  const recordedTimes = metadata.sampledFrameTimestampsMs || frameTimes;
  const expectedProvider = String(env.SEMANTIC_VISUAL_PROVIDER || metadata.provider || '').toLowerCase();
  const expectedModel = env.SEMANTIC_VISUAL_MODEL || metadata.model || null;
  return frameHashes.length > 0 && sameArray(frameHashes, recordedHashes) && sameArray(frameTimes, recordedTimes)
    && String(metadata.provider || '').toLowerCase() === expectedProvider && metadata.model === expectedModel;
}

function durableMedia(row) {
  return Boolean(row?.status === 'SUCCEEDED' && row.artifact_storage_key && row.artifact_content_hash);
}

function sourceArtifact(row) {
  return Object.freeze({
    artifactId: row.artifact_id,
    version: row.artifact_version,
    storageKey: row.artifact_storage_key,
    contentHash: row.artifact_content_hash,
  });
}

function recoverySemanticAdapter({ candidate, delegate, reuseAllowed }) {
  const prior = candidate.semantic;
  return Object.freeze({
    provider: prior?.metadata?.provider || delegate?.provider || 'unconfigured',
    model: prior?.metadata?.model || delegate?.model || null,
    configured: reuseAllowed || delegate?.configured === true,
    paidExecutionAuthorized: reuseAllowed || delegate?.paidExecutionAuthorized === true,
    async evaluate(input) {
      const hashes = (input.frames || []).map((frame) => frame.analysisHash).filter(Boolean);
      const times = (input.frames || []).map((frame) => frame.timestampMs);
      const recordedHashes = prior?.metadata?.sampledFrameHashes
        || (candidate.sampledFrames || []).map((frame) => frame.analysisHash).filter(Boolean);
      const recordedTimes = prior?.metadata?.sampledFrameTimestampsMs
        || (candidate.sampledFrames || []).map((frame) => frame.timestampMs);
      if (reuseAllowed && sameArray(hashes, recordedHashes) && sameArray(times, recordedTimes)) {
        return Object.freeze({ ...prior, metadata: Object.freeze({ ...(prior.metadata || {}),
          externalCalls: 0, attempts: 0, reused: true, reusedEvidenceVersion: prior.metadata?.evaluatorVersion || null,
          originalExternalCalls: Number(prior.metadata?.externalCalls || 0),
          originalRequestId: prior.metadata?.requestId || null,
        }) });
      }
      return delegate.evaluate(input);
    },
    async evaluateContinuity(input) { return delegate.evaluateContinuity(input); },
  });
}

function recoveredSourceQuality(previous, recovered) {
  const shots = (previous?.shots || []).map((shot) => shot.assetId === recovered.assetId ? recovered : shot);
  const status = shots.some((shot) => shot.status === 'FAIL') ? 'FAIL'
    : shots.some((shot) => shot.status === 'WARN') ? 'WARN' : 'PASS';
  return Object.freeze({ ...previous, status, score: recovered.score, shots: Object.freeze(shots),
    deterministicVisual: recovered.deterministicVisual || previous?.deterministicVisual || null,
    temporal: recovered.temporal || previous?.temporal || null,
    semantic: recovered.semantic || previous?.semantic || null,
    reconciliation: recovered.reconciliation || null,
    disposition: recovered.disposition || recovered.reconciliation?.disposition || null });
}

function recoveredProductionQuality(previous, sourceQuality) {
  const lifecycle = Object.freeze({ ...(previous?.lifecycle || {}),
    sourceTechnical: sourceQuality?.deterministicVisual?.checks?.some((check) => check.status === 'FAIL'
      && check.qualityClass === 'SOURCE_TECHNICAL') ? 'FAIL' : 'PASS',
    sourceVisual: sourceQuality?.status || 'WARN',
    temporalQuality: sourceQuality?.temporal?.status || 'NOT_STARTED',
    creativeCompliance: sourceQuality?.semantic?.status || 'NOT_STARTED',
    masterAssembly: 'BLOCKED', masterTechnical: 'NOT_STARTED', finalQuality: 'NOT_STARTED', humanReview: 'BLOCKED' });
  return Object.freeze({ ...previous, status: sourceQuality.status, score: sourceQuality.score,
    approvalStatus: 'BLOCKED', readyForHumanReview: false, publicationAllowed: false,
    lifecycle, recoveryDisposition: sourceQuality.disposition || null });
}

class QualityRecoveryService {
  constructor({ repository, storage, commandService, env = process.env, logger = console,
    semanticAdapterFactory = createSemanticVisualEvaluatorAdapter } = {}) {
    if (!repository || !storage || !commandService) throw new Error('repository, storage, and commandService are required');
    this.repository = repository;
    this.storage = storage;
    this.commandService = commandService;
    this.env = env;
    this.logger = logger;
    this.semanticAdapterFactory = semanticAdapterFactory;
    this.artifactService = new ArtifactService({ storage });
  }

  async load(productionId, brandId) {
    const production = await this.repository.getCommandProduction(productionId, brandId);
    if (!production) throw new QualityRecoveryError(404, 'PRODUCTION_NOT_FOUND', 'Production not found in brand scope');
    return production;
  }

  async inspect({ productionId, brandId, production = null } = {}) {
    const item = production || await this.load(productionId, brandId);
    const recovered = item.jobPayload?.qualityRecovery;
    if (item.jobStatus === 'RETRYING' && recovered?.status === 'SUCCEEDED') {
      return Object.freeze({ eligible: false, recovered: true, action: 'CONTINUE_SAME_EXECUTION',
        status: 'READY_TO_CONTINUE', videoRegenerations: 0, semanticEvaluations: recovered.semanticExternalCalls || 0,
        evidence: recovered.evidence || null, disposition: recovered.disposition || null });
    }
    if (item.jobStatus !== 'FAILED' || item.jobError?.code !== RECOVERABLE_ERROR) {
      return Object.freeze({ eligible: false, recovered: false, action: null, status: 'NOT_APPLICABLE' });
    }
    const candidate = candidateFromProduction(item);
    if (!candidate?.assetId) return Object.freeze({ eligible: false, recovered: false, action: null,
      status: 'BLOCKED', reason: 'A single failed source asset could not be identified from durable quality evidence.' });
    const safety = await this.repository.executionSafety(item.id);
    if (safety.ambiguousExecutions > 0) return Object.freeze({ eligible: false, recovered: false,
      action: 'RECONCILE_EXTERNAL_EXECUTION', status: 'BLOCKED', reason: 'Ambiguous provider execution must be reconciled first.' });
    const executions = await this.repository.semanticRetryMediaExecutions(item.id, item.brandId);
    const row = executions.find((entry) => String(entry.asset_id) === String(candidate.assetId));
    if (!durableMedia(row)) return Object.freeze({ eligible: false, recovered: false, action: 'REGENERATE_SHOT',
      status: 'BLOCKED', reason: 'The failed source has no complete immutable media artifact to re-evaluate.', assetId: candidate.assetId });
    const reuseSemantic = semanticEvidenceReusable(candidate, this.env);
    const delegate = this.semanticAdapterFactory({ env: this.env });
    const semanticReady = reuseSemantic || (delegate.configured === true && delegate.paidExecutionAuthorized === true);
    return Object.freeze({
      eligible: semanticReady,
      recovered: false,
      action: semanticReady ? 'RE_EVALUATE_EXISTING_ASSET' : null,
      status: semanticReady ? 'READY' : 'BLOCKED',
      assetId: candidate.assetId,
      sourceArtifact: sourceArtifact(row),
      existingMedia: 'REUSED',
      videoRegenerations: 0,
      newVideoGenerations: 0,
      semanticEvidence: reuseSemantic ? 'REUSED' : 'NEEDS_EVALUATION',
      semanticEvaluations: reuseSemantic ? 0 : 1,
      expectedExternalCalls: reuseSemantic ? 0 : 1,
      previousEvidenceArtifact: candidate.evidenceArtifact || null,
      evidenceVersionFrom: candidate.metadata?.evaluatorVersion || candidate.deterministicVisual?.metadata?.evaluator || 'v2.9',
      evidenceVersionTo: QUALITY_RECOVERY_VERSION,
      readiness: semanticReady ? 'READY' : 'SEMANTIC_EVALUATOR_REQUIRED',
      nextActionAfterRecovery: 'CONTINUE_SAME_EXECUTION',
    });
  }

  async preflight(args) { return this.inspect(args); }

  async recover({ productionId, brandId, confirmation }) {
    if (confirmation !== true) throw new QualityRecoveryError(400, 'QUALITY_RECOVERY_CONFIRMATION_REQUIRED',
      'Explicit quality-recovery confirmation is required');
    const production = await this.load(productionId, brandId);
    if (production.jobStatus === 'RETRYING' && production.jobPayload?.qualityRecovery?.status === 'SUCCEEDED') {
      return Object.freeze({ accepted: false, reused: true, ...production.jobPayload.qualityRecovery });
    }
    const plan = await this.inspect({ productionId, brandId, production });
    if (!plan.eligible) throw new QualityRecoveryError(409, 'QUALITY_RECOVERY_UNAVAILABLE',
      plan.reason || 'Quality evidence recovery is not available for this production', plan);
    const candidate = candidateFromProduction(production);
    const executions = await this.repository.semanticRetryMediaExecutions(production.id, production.brandId);
    const row = executions.find((entry) => String(entry.asset_id) === String(candidate.assetId));
    const bytes = await this.storage.get({ key: row.artifact_storage_key });
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== row.artifact_content_hash) throw new QualityRecoveryError(409, 'QUALITY_RECOVERY_SOURCE_HASH_MISMATCH',
      'Immutable source bytes do not match the recorded content hash; regeneration was not attempted');

    const delegate = this.semanticAdapterFactory({ env: this.env });
    const reuseAllowed = semanticEvidenceReusable(candidate, this.env);
    const semanticAdapter = recoverySemanticAdapter({ candidate, delegate, reuseAllowed });
    const evaluator = new VisualQualityEvaluator({ semanticAdapter });
    const evaluation = await evaluator.evaluate({
      media: { bytes, contentType: 'video/mp4', mediaProbe: candidate.sourceProbe || {} },
      creativePlan: production.jobPayload?.canonicalRawInput?.creative_plan || null,
      negativeIntent: production.jobPayload?.canonicalRawInput?.visual_style?.avoid || null,
      expectedAspectRatio: production.jobPayload?.canonicalRawInput?.aspect_ratio || '9:16',
      intendedContentType: 'cinematic',
      qualityTier: candidate.profile || production.jobPayload?.canonicalRawInput?.quality_video_profile?.name || 'STANDARD',
      provider: candidate.provider || row.provider || null,
      model: candidate.model || row.model || null,
      generationSettings: candidate.generationSettings || {},
      motionExpected: true,
      evaluationClass: 'SOURCE_RECOVERY',
      semanticEvaluationRequired: true,
    });
    const persisted = await persistVisualQualityEvidence({ artifactService: this.artifactService,
      brandId: production.brandId, productionId: production.id, assetId: candidate.assetId,
      sourceArtifact: sourceArtifact(row), evaluation, evaluationClass: 'source-recovery-v2.10.1' });
    const recoveredShot = Object.freeze({ ...candidate, ...persisted, assetId: candidate.assetId,
      recoveryVersion: QUALITY_RECOVERY_VERSION, supersedesEvidenceArtifact: candidate.evidenceArtifact || null });
    const sourceQuality = recoveredSourceQuality(production.jobError?.details?.sourceQuality, recoveredShot);
    const quality = recoveredProductionQuality(production.jobError?.details?.quality, sourceQuality);
    const semanticExternalCalls = Number(persisted.semantic?.metadata?.externalCalls || 0);
    const summary = Object.freeze({ status: persisted.disposition === 'BLOCK' ? 'BLOCKED' : 'SUCCEEDED',
      version: QUALITY_RECOVERY_VERSION, assetId: candidate.assetId, disposition: persisted.disposition,
      evidence: persisted.evidenceArtifact || null, previousEvidence: candidate.evidenceArtifact || null,
      existingMedia: 'REUSED', videoRegenerations: 0, semanticExternalCalls,
      semanticEvidenceReused: persisted.semantic?.metadata?.reused === true,
      recoveredAt: new Date().toISOString() });

    const client = typeof this.repository.db.connect === 'function' ? await this.repository.db.connect() : this.repository.db;
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT id,status,error,payload FROM v2_1.jobs WHERE id=$1 AND production_id=$2 FOR UPDATE',
        [production.jobId, production.id]);
      const current = locked.rows[0];
      if (!current) throw new QualityRecoveryError(404, 'QUALITY_RECOVERY_JOB_NOT_FOUND', 'Durable job was not found');
      if (current.status === 'RETRYING' && current.payload?.qualityRecovery?.status === 'SUCCEEDED') {
        await client.query('ROLLBACK');
        return Object.freeze({ accepted: false, reused: true, ...current.payload.qualityRecovery });
      }
      if (current.status !== 'FAILED' || current.error?.code !== RECOVERABLE_ERROR) {
        throw new QualityRecoveryError(409, 'QUALITY_RECOVERY_STATE_CHANGED',
          `Quality recovery cannot continue while durable job is ${current.status}`);
      }
      const nextError = persisted.disposition === 'BLOCK' ? {
        ...current.error,
        details: { ...(current.error?.details || {}), sourceQuality, quality, qualityRecovery: summary },
      } : {
        code: 'QUALITY_EVIDENCE_RECOVERED',
        message: 'Existing immutable source was re-evaluated without video regeneration and is ready for same-execution continuation.',
        details: { sourceQuality, quality, qualityRecovery: summary, previousFailure: current.error,
          paidRegenerationTriggered: false, providerExecutions: 0 },
      };
      const nextStatus = persisted.disposition === 'BLOCK' ? 'FAILED' : 'RETRYING';
      const updated = await client.query(`UPDATE v2_1.jobs SET status=$3,error=$4::jsonb,
        payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object('qualityRecovery',$5::jsonb),
        worker_id=NULL,lease_expires_at=NULL,next_attempt_at=CASE WHEN $3='RETRYING' THEN now() ELSE next_attempt_at END,
        updated_at=now() WHERE id=$1 AND production_id=$2 RETURNING *`,
      [production.jobId, production.id, nextStatus, JSON.stringify(nextError), JSON.stringify(summary)]);
      await client.query('COMMIT');
      return Object.freeze({ accepted: persisted.disposition !== 'BLOCK', reused: false,
        productionId: production.id, jobId: production.jobId, jobStatus: updated.rows[0].status,
        ...summary, nextAction: persisted.disposition === 'BLOCK' ? 'REGENERATE_SHOT' : 'CONTINUE_SAME_EXECUTION' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (client !== this.repository.db) client.release();
    }
  }
}

module.exports = {
  QUALITY_RECOVERY_VERSION,
  QualityRecoveryError,
  QualityRecoveryService,
  candidateFromProduction,
  durableMedia,
  recoverySemanticAdapter,
  semanticEvidenceReusable,
};
