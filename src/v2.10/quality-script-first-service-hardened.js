'use strict';

const { QualityScriptFirstService } = require('./quality-script-first-service');

class HardenedQualityScriptFirstService extends QualityScriptFirstService {
  async state({ id, brandId }) {
    const scope = await this.scope(brandId);
    await this.draft(id, scope);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    const workflow = typeof this.repository.getLockedWorkflow === 'function'
      ? await this.repository.getLockedWorkflow({ draftId: id, ...scope }) : null;
    const pilotAttempt = workflow && typeof this.repository.getLatestLockedStageAttempt === 'function'
      ? await this.repository.getLatestLockedStageAttempt({ workflowId: workflow.id, ...scope, stage: 'FIRST_VIDEO' }) : null;
    return Object.freeze({
      ...state,
      workflow: workflow ? {
        id: workflow.id,
        productionId: workflow.production_id,
        state: workflow.state,
        openingShotId: workflow.opening_shot_id,
        draftRevision: Number(workflow.draft_revision || 0),
        canonicalIntentFingerprint: workflow.canonical_intent_fingerprint,
      } : null,
      pilotAttempt: pilotAttempt ? {
        id: pilotAttempt.id,
        status: pilotAttempt.status,
        result: pilotAttempt.result,
        completedAt: pilotAttempt.completed_at,
      } : null,
      externalCalls: 0,
    });
  }
}

module.exports = { HardenedQualityScriptFirstService };
