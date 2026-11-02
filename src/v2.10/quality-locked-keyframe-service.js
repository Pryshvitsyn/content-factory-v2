'use strict';

const crypto = require('node:crypto');
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
    let selection = await this.resolveKeyframeSelection(scope, keyframe);
    if (selection.sourceType === 'OPERATOR_UPLOAD') {
      selection = Object.freeze({ ...selection, resolvedSettings: Object.freeze({
        ...selection.resolvedSettings,
        uploadPreflightNonce: crypto.randomUUID(),
      }) });
    }
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
    const state = await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    if (!state?.look?.expectedFingerprint || state.look.keyframeId !== args.keyframeId
      || args.lookFingerprint !== state.look.expectedFingerprint) {
      throw new LockedKeyframeError('STALE_LOOK_APPROVAL', 'Reload and review the existing keyframe against the current Script and Storyboard.');
    }
    if (args.confirmation !== true) throw new LockedKeyframeError('EXPLICIT_CONFIRMATION_REQUIRED', 'Explicit LOOK approval is required');
    const scope = await this.scope(args.brandId);
    const keyframe = await this.repository.getKeyframe({ id: args.keyframeId, ...scope });
    if (state.look.approved) return Object.freeze({ keyframe: require('./locked-keyframe-service').publicKeyframe(keyframe),
      canonicalReference: require('./locked-keyframe-contract').approvedKeyframeIdentity(keyframe),
      lookApproved: true, reused: true, productionPreflightInvalidated: false, externalCalls: 0 });
    const draft = await this.draft(args.id, scope);
    const ref = draft.creative_brief?.storyboard?.[0]?.referenceMedia;
    const alreadyBound = keyframe.approval_decision === 'APPROVED' && ref?.artifactId === keyframe.id
      && Number(ref.version) === Number(keyframe.version) && ref.contentHash === keyframe.content_hash
      && ref.storageKey === keyframe.storage_key;
    const result = alreadyBound ? { keyframe: require('./locked-keyframe-service').publicKeyframe(keyframe),
      canonicalReference: require('./locked-keyframe-contract').approvedKeyframeIdentity(keyframe),
      productionPreflightInvalidated: true } : await super.approveKeyframe(args);
    await this.repository.recordCurrentLookApproval({ draftId: args.id, ...scope, keyframeId: args.keyframeId,
      expectedFingerprint: args.lookFingerprint, actor: this.actor, reason: args.reason || 'REVIEWED_CURRENT_LOOK' });
    return Object.freeze({ ...result, lookApproved: true, externalCalls: 0,
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
