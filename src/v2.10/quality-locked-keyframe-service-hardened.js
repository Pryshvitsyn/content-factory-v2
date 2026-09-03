'use strict';

const { QualityLockedKeyframeService } = require('./quality-locked-keyframe-service');

class HardenedQualityLockedKeyframeService extends QualityLockedKeyframeService {
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
};
