'use strict';

const { LockedKeyframeService } = require('./locked-keyframe-service');
const { fingerprint } = require('./creative-contract');

class QualityLockedKeyframeService extends LockedKeyframeService {
  async requireDirectorGate(id, brandId, requiredStages) {
    if (typeof this.repository.assertQualityDirectorGate !== 'function') return null;
    const scope = await this.scope(brandId);
    return this.repository.assertQualityDirectorGate({ draftId: id, ...scope, requiredStages });
  }

  async preflightKeyframe(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    return super.preflightKeyframe(args);
  }

  async executeKeyframe(args) {
    await this.requireDirectorGate(args.id, args.brandId, ['SCRIPT', 'STORYBOARD']);
    return super.executeKeyframe(args);
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

module.exports = { QualityLockedKeyframeService };
