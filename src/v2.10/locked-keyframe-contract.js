'use strict';

const crypto = require('node:crypto');
const { CAPABILITIES } = require('../v2.8/capabilities');
const { canonicalCreativeBrief, buildShotPrompt, fingerprint, freeze } = require('./creative-contract');

const KEYFRAME_SOURCE_TYPES = Object.freeze(['AI_GENERATED', 'OPERATOR_UPLOAD']);
const STAGES = Object.freeze({ KEYFRAME: 'KEYFRAME', FIRST_VIDEO: 'FIRST_VIDEO' });

class LockedKeyframeError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = 'LockedKeyframeError'; this.code = code; this.status = 409; this.details = details;
  }
}

function required(value, code, message) {
  if (value === undefined || value === null || String(value).trim() === '') throw new LockedKeyframeError(code, message);
  return value;
}

function resolveShot(briefInput, shotId) {
  const brief = canonicalCreativeBrief(briefInput);
  const shot = brief.storyboard.find((item) => item.shotId === shotId);
  if (!shot) throw new LockedKeyframeError('LOCKED_KEYFRAME_SHOT_NOT_FOUND', `Shot '${shotId}' is not in the canonical storyboard`);
  return { brief, shot };
}

function buildKeyframePrompt(briefInput, shotId) {
  const { brief, shot } = resolveShot(briefInput, shotId);
  return [
    'Create one immutable opening keyframe for the approved advertising shot plan.',
    buildShotPrompt(brief, shot),
    'This is a still frame, not a motion sequence. Show the approved opening state exactly and preserve empty space required by the composition.',
  ].join(' ');
}

function shotPlanFingerprint(briefInput, shotId) {
  const { brief, shot } = resolveShot(briefInput, shotId);
  return fingerprint({ shot, continuity: brief.continuity, visualStyle: brief.visualStyle,
    objective: brief.objective, creativeConcept: brief.creativeConcept });
}

function normalizeKeyframeSelection(raw = {}) {
  const sourceType = String(raw.sourceType || '').toUpperCase();
  if (!KEYFRAME_SOURCE_TYPES.includes(sourceType)) {
    throw new LockedKeyframeError('KEYFRAME_SOURCE_REQUIRED', 'Select AI_GENERATED or OPERATOR_UPLOAD for the keyframe');
  }
  if (sourceType === 'OPERATOR_UPLOAD') {
    const rawNonce = raw.uploadPreflightNonce || raw.resolvedSettings?.uploadPreflightNonce || null;
    const uploadPreflightNonce = rawNonce == null ? null : String(rawNonce).trim();
    if (uploadPreflightNonce && !/^[a-zA-Z0-9-]{8,128}$/.test(uploadPreflightNonce)) {
      throw new LockedKeyframeError('KEYFRAME_UPLOAD_PREFLIGHT_ID_INVALID', 'Operator-upload preflight identity is invalid');
    }
    return freeze({ sourceType, provider: 'operator-upload', model: 'uploaded-image',
      profile: 'UPLOAD', capability: CAPABILITIES.TEXT_TO_IMAGE,
      resolvedSettings: uploadPreflightNonce ? { uploadPreflightNonce } : {} });
  }
  return freeze({ sourceType, provider: required(raw.provider, 'KEYFRAME_PROVIDER_REQUIRED', 'Keyframe provider is required'),
    model: required(raw.model, 'KEYFRAME_MODEL_REQUIRED', 'Keyframe model is required'),
    profile: String(required(raw.profile, 'KEYFRAME_PROFILE_REQUIRED', 'Keyframe profile is required')).toUpperCase(),
    capability: CAPABILITIES.TEXT_TO_IMAGE, resolvedSettings: { ...(raw.resolvedSettings || {}) } });
}

function buildKeyframeStagePlan({ draft, shotId, selection: rawSelection, semantic = {} }) {
  const selection = normalizeKeyframeSelection(rawSelection);
  const { shot } = resolveShot(draft.creative_brief || draft.creativeBrief, shotId);
  const imageCalls = selection.sourceType === 'AI_GENERATED' ? 1 : 0;
  const semanticCalls = 1;
  const plan = {
    schemaVersion: 'locked-keyframe/1', stage: STAGES.KEYFRAME, draftId: draft.id,
    draftRevision: Number(draft.revision), shotId: shot.shotId, assetId: shot.assetId,
    executionAssets: [{ assetId: `${shot.assetId}:keyframe`, kind: 'image', sourceType: selection.sourceType }],
    provider: selection.provider, model: selection.model, profile: selection.profile,
    capability: selection.capability, resolvedSettings: selection.resolvedSettings,
    prompt: buildKeyframePrompt(draft.creative_brief || draft.creativeBrief, shotId),
    externalCalls: { imageGeneration: imageCalls, semanticImageEvaluation: semanticCalls,
      semanticRetries: 0, video: 0, voice: 0, continuity: 0, renderer: 0,
      maximum: imageCalls + semanticCalls, alreadyMade: 0 },
    cost: { knownUsd: null, status: 'UNKNOWN', unknownComponents: [
      ...(imageCalls ? [`${selection.provider}/${selection.model} image generation`] : []),
      `${semantic.provider || 'configured-semantic-provider'}/${semantic.model || 'configured-semantic-model'} still evaluation`,
    ] },
    humanApprovalRequired: true, autoPublish: false,
  };
  plan.fingerprint = fingerprint(plan);
  return freeze(plan);
}

function approvedKeyframeIdentity(keyframe) {
  if (!keyframe?.id || !keyframe.version || !keyframe.content_hash || !keyframe.storage_key) {
    throw new LockedKeyframeError('APPROVED_KEYFRAME_MISSING', 'Exact immutable keyframe identity is required');
  }
  if (keyframe.validation_status !== 'PASS' || keyframe.approval_decision !== 'APPROVED') {
    throw new LockedKeyframeError('KEYFRAME_NOT_APPROVED', 'Only an exact validated and human-approved keyframe may condition video');
  }
  return freeze({ artifactId: keyframe.id, version: Number(keyframe.version), contentHash: keyframe.content_hash,
    storageKey: keyframe.storage_key, contentType: keyframe.content_type, width: Number(keyframe.width),
    height: Number(keyframe.height), source: keyframe.source_type, immutable: true,
    approvalEventId: keyframe.approval_event_id, validationEventId: keyframe.validation_event_id });
}

function bindApprovedKeyframe(briefInput, shotId, keyframe) {
  const brief = canonicalCreativeBrief(briefInput);
  const identity = approvedKeyframeIdentity(keyframe);
  const storyboard = brief.storyboard.map((shot) => shot.shotId === shotId ? {
    ...shot, referencePolicy: 'UPLOADED_REFERENCE', referenceMedia: identity,
  } : shot);
  return canonicalCreativeBrief({ ...brief, storyboard });
}

function buildFirstVideoStagePlan({ draft, canonical, keyframe, executionAsset, semantic = {} }) {
  const identity = approvedKeyframeIdentity(keyframe);
  if (!executionAsset || executionAsset.kind !== 'video') {
    throw new LockedKeyframeError('FIRST_VIDEO_ASSET_MISSING', 'Prepared first-video execution must contain exactly one video asset');
  }
  const reference = executionAsset.generation_requirements?.v210_reference?.artifact;
  if (!reference || reference.artifactId !== identity.artifactId || Number(reference.version) !== identity.version
    || reference.contentHash !== identity.contentHash || reference.storageKey !== identity.storageKey) {
    throw new LockedKeyframeError('KEYFRAME_REFERENCE_MISMATCH', 'Prepared video does not reference the exact approved keyframe version');
  }
  const plan = {
    schemaVersion: 'locked-keyframe/1', stage: STAGES.FIRST_VIDEO, draftId: draft.id,
    draftRevision: Number(draft.revision), productionId: keyframe.production_id,
    shotId: keyframe.shot_id, assetId: executionAsset.asset_id,
    canonicalInputFingerprint: canonical.input.fingerprint,
    keyframe: identity,
    executionAssets: [{ assetId: executionAsset.asset_id, kind: 'video', capability: CAPABILITIES.IMAGE_TO_VIDEO }],
    provider: executionAsset.generation_requirements?.provider,
    model: executionAsset.generation_requirements?.model,
    profile: executionAsset.generation_requirements?.profile,
    capability: executionAsset.generation_requirements?.capability,
    resolvedSettings: executionAsset.generation_requirements?.resolved_settings || {},
    externalCalls: { imageGeneration: 0, video: 1, semanticVideoEvaluation: 1, semanticRetries: 0,
      voice: 0, continuity: 0, renderer: 0, maximum: 2, alreadyMade: 0 },
    cost: { knownUsd: null, status: 'UNKNOWN', unknownComponents: [
      `${executionAsset.generation_requirements?.provider}/${executionAsset.generation_requirements?.model} video generation`,
      `${semantic.provider || 'configured-semantic-provider'}/${semantic.model || 'configured-semantic-model'} video evaluation`,
    ] },
    humanApprovalRequired: true, autoPublish: false, remainingProductionScheduled: false,
  };
  plan.executionFingerprint = fingerprint({ canonicalInputFingerprint: plan.canonicalInputFingerprint,
    draftRevision: plan.draftRevision, executionAsset, keyframe: identity });
  plan.fingerprint = fingerprint(plan);
  return freeze(plan);
}

function sanitizeEvaluatorResult(result = {}) {
  const allowedStatus = ['PASS', 'WARN', 'FAIL'].includes(result.status) ? result.status : 'FAIL';
  const checks = Array.isArray(result.checks) ? result.checks.slice(0, 100).map((check) => ({
    code: String(check?.code || 'UNTRUSTED_EVALUATOR_RESULT').slice(0, 128),
    status: ['PASS', 'WARN', 'FAIL'].includes(check?.status) ? check.status : 'FAIL',
    reason: String(check?.reason || '').slice(0, 2000),
  })) : [];
  return freeze({ status: allowedStatus, checks,
    metadata: { provider: String(result.metadata?.provider || result.metadata?.semanticProvider || '').slice(0, 128) || null,
      model: String(result.metadata?.model || result.metadata?.semanticModel || '').slice(0, 256) || null,
      externalCalls: Math.min(1, Math.max(0, Number(result.metadata?.externalCalls ?? 1))),
      untrustedExternalData: true } });
}

function contentHash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

module.exports = { KEYFRAME_SOURCE_TYPES, STAGES, LockedKeyframeError, approvedKeyframeIdentity,
  bindApprovedKeyframe, buildFirstVideoStagePlan, buildKeyframePrompt, buildKeyframeStagePlan,
  contentHash, normalizeKeyframeSelection, resolveShot, sanitizeEvaluatorResult, shotPlanFingerprint };
