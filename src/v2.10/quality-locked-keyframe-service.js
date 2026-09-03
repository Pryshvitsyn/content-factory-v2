'use strict';

const { IMAGE_TYPES, LockedKeyframeService } = require('./locked-keyframe-service');
const { buildKeyframeStagePlan, LockedKeyframeError, STAGES } = require('./locked-keyframe-contract');
const { fingerprint } = require('./creative-contract');
const { FfmpegReferenceGeometryNormalizer } = require('../v2.10.2/reference-geometry');

function keyframeUploadResolution(env = process.env) {
  const value = String(env.QUALITY_VIDEO_RESOLUTION || '720p').toLowerCase();
  return ['480p', '720p', '1080p'].includes(value) ? value : '720p';
}

async function normalizeUploadedKeyframeArgs(args, {
  normalizer = new FfmpegReferenceGeometryNormalizer(),
  resolution = '720p',
} = {}) {
  if (!args?.contentBase64) return Object.freeze({ args, normalization: null });
  const contentType = String(args.contentType || 'image/jpeg').split(';', 1)[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(contentType)) return Object.freeze({ args, normalization: null });

  const sourceBytes = Buffer.from(args.contentBase64, 'base64');
  const normalized = await normalizer.normalize({
    bytes: sourceBytes,
    contentType,
    expectedAspectRatio: '9:16',
    resolution,
  });

  return Object.freeze({
    args: Object.freeze({
      ...args,
      contentBase64: normalized.bytes.toString('base64'),
      contentType: normalized.contentType,
    }),
    normalization: Object.freeze({
      applied: normalized.normalizationApplied === true,
      policy: normalized.policy,
      version: normalized.normalizationVersion,
      before: normalized.before,
      after: normalized.after,
      expectedAspectRatio: '9:16',
      resolution,
    }),
  });
}

class QualityLockedKeyframeService extends LockedKeyframeService {
  async requireDirectorGate(id, brandId, requiredStages) {
    if (typeof this.repository.assertQualityDirectorGate !== 'function') return null;
    const scope = await this.scope(brandId);
    return this.repository.assertQualityDirectorGate({ draftId: id, ...scope, requiredStages });
  }

  async preflightKeyframe(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    const { id, brandId, shotId, keyframe = {} } = args;
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const selection = await this.resolveKeyframeSelection(scope, keyframe);
    const workflow = await this.workflow({ draft, scope, shotId });
    const plan = buildKeyframeStagePlan({ draft, shotId, selection,
      semantic: { provider: this.env.SEMANTIC_VISUAL_PROVIDER, model: this.env.SEMANTIC_VISUAL_MODEL } });
    const stored = await this.repository.saveLockedStagePreflight({ workflowId: workflow.id, ...scope,
      stage: STAGES.KEYFRAME, draftRevision: draft.revision, plan, actor: this.actor });
    return Object.freeze({ ...plan, preflightId: stored.id, productionId: workflow.production_id,
      executionReadiness: this.stillEvaluator?.configured === true ? 'READY' : 'BLOCKED_SEMANTIC_EVALUATOR_NOT_CONFIGURED',
      semanticEvaluatorConfigured: this.stillEvaluator?.configured === true,
      providerCallsMade: 0 });
  }

  async executeKeyframe(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    if (!this.stillEvaluator || this.stillEvaluator.configured === false) {
      throw new LockedKeyframeError('SEMANTIC_STILL_EVALUATOR_NOT_CONFIGURED',
        'Semantic still evaluator must be configured before keyframe execution; no provider calls were made');
    }
    const normalized = await normalizeUploadedKeyframeArgs(args, {
      resolution: keyframeUploadResolution(this.env),
    });
    return super.executeKeyframe(normalized.args);
  }

  async approveKeyframe(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    const result = await super.approveKeyframe(args);
    if (typeof this.repository.recordQualityApproval === 'function') {
      const scope = await this.scope(args.brandId);
      const keyframe = result.keyframe;
      const subjectFingerprint = fingerprint({
        id: keyframe.id,
        version: keyframe.version,
        contentHash: keyframe.contentHash,
        storageKey: keyframe.storageKey,
        approvalEventId: keyframe.approvalEventId,
      });
      const latest = typeof this.repository.latestQualityStageEvent === 'function'
        ? await this.repository.latestQualityStageEvent({ draftId: args.id, ...scope, stage: 'LOOK' }) : null;
      if (!(latest?.decision === 'APPROVED' && latest.subject_fingerprint === subjectFingerprint)) {
        await this.repository.recordQualityApproval({ draftId: args.id, ...scope, stage: 'LOOK',
          subjectType: 'KEYFRAME', subjectId: keyframe.id, subjectFingerprint,
          decision: 'APPROVED', reason: args.reason || 'APPROVED_EXACT_KEYFRAME', actor: this.actor });
      }
      if (typeof this.repository.invalidateQualityStages === 'function') {
        await this.repository.invalidateQualityStages({ draftId: args.id, ...scope, fromStage: 'PILOT',
          reason: 'LOOK_APPROVED_NEW_TRUTH', actor: this.actor });
      }
    }
    return Object.freeze({ ...result, lookApproved: true,
      nextRequiredAction: 'RUN_FINAL_PRODUCTION_PREFLIGHT_THEN_PILOT' });
  }

  async preflightFirstVideo(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD', 'LOOK']);
    return super.preflightFirstVideo(args);
  }

  async startFirstVideo(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD', 'LOOK']);
    const result = await super.startFirstVideo(args);
    return Object.freeze({ ...result,
      readyForContinuationPreflight: false,
      humanPilotApprovalRequired: result.accepted === true,
      nextRequiredAction: result.accepted ? 'APPROVE_LOOK_AND_MOTION' : 'STOP_AND_REVIEW_FAILURE',
      remainingProductionScheduled: false,
      humanApprovalRequired: true,
      autoPublish: false,
    });
  }
}

module.exports = {
  QualityLockedKeyframeService,
  keyframeUploadResolution,
  normalizeUploadedKeyframeArgs,
};
