'use strict';

const { HardenedQualityLockedKeyframeService: _Unused } = {};
const { QualityLockedKeyframeService } = require('./quality-locked-keyframe-service');
const { IMAGE_TYPES } = require('./locked-keyframe-service');
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
  const contentType = args.contentType || 'image/jpeg';
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

class HardenedQualityLockedKeyframeService extends QualityLockedKeyframeService {
  async executeKeyframe(args) {
    const normalized = await normalizeUploadedKeyframeArgs(args, {
      resolution: keyframeUploadResolution(this.env),
    });
    return super.executeKeyframe(normalized.args);
  }

  async startFirstVideo(args) {
    const result = await super.startFirstVideo(args);
    const scope = await this.scope(args.brandId);
    const workflow = await this.repository.getLockedWorkflow({ draftId: args.id, ...scope });
    return Object.freeze({
      ...result,
      workflowId: workflow?.id || null,
      workflowState: workflow?.state || null,
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
  HardenedQualityLockedKeyframeService,
  keyframeUploadResolution,
  normalizeUploadedKeyframeArgs,
};
