'use strict';

const { QualityScriptFirstService } = require('./quality-script-first-service');

class HardenedQualityScriptFirstService extends QualityScriptFirstService {
  async decidePilot({ id, brandId, workflowId, attemptId, confirmation, reason }, decision) {
    if (confirmation !== true) throw Object.assign(new Error('Explicit pilot review decision is required'),
      { code: 'EXPLICIT_CONFIRMATION_REQUIRED', status: 409 });
    const scope = await this.scope(brandId);
    await this.draft(id, scope);
    if (decision === 'APPROVED') await this.pilotContent({ id, brandId, attemptId });
    const { event, workflow } = await this.repository.decidePilot({ draftId: id, ...scope, workflowId, attemptId,
      decision, actor: this.actor, reason });
    return { approved: decision === 'APPROVED', rejected: decision === 'REJECTED', approvalEventId: event.id,
      workflow, externalCalls: 0, remainingProductionScheduled: false, autoPublish: false,
      nextRequiredAction: decision === 'APPROVED' ? 'RUN_CONTINUATION_PREFLIGHT' : 'FIX_PILOT_SHOT' };
  }

  async approvePilot(args) { return this.decidePilot(args, 'APPROVED'); }
  async rejectPilot(args) { return this.decidePilot(args, 'REJECTED'); }

  async state({ id, brandId }) {
    const scope = await this.scope(brandId);
    if (!await this.repository.getDraft({ id, ...scope })) throw Object.assign(new Error('Draft not found'), { code: 'DRAFT_NOT_FOUND', status: 404 });
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    const workflow = typeof this.repository.getLockedWorkflow === 'function'
      ? await this.repository.getLockedWorkflow({ draftId: id, ...scope }) : null;
    const pilotAttempt = workflow && typeof this.repository.getLatestLockedStageAttempt === 'function'
      ? await this.repository.getLatestLockedStageAttempt({ workflowId: workflow.id, ...scope, stage: 'FIRST_VIDEO' }) : null;
    const review = require('./pilot-review').pilotReview({ draftId: id, brandId, workflow, attempt: pilotAttempt });
    return Object.freeze({
      ...state,
      pilotReview: review ? { ...review, canApprove: review.canApprove && state.script.approved && state.storyboard.approved && state.look.approved } : null,
      workflow: workflow ? {
        id: workflow.id,
        productionId: pilotAttempt?.result?.productionId || workflow.production_id,
        keyframeOriginProductionId: workflow.production_id,
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

  async pilotContent({ id, brandId, attemptId }) {
    const scope = await this.scope(brandId);
    return require('./pilot-review').pilotContent({ repository: this.repository,
      storage: this.repository.storage, scope, draftId: id, attemptId });
  }

  async restorePilotReview({ id, brandId, workflowId, attemptId }) {
    const scope = await this.scope(brandId);
    await this.draft(id, scope);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope });
    if (!workflow || workflow.id !== workflowId || !attemptId) throw Object.assign(new Error('Reload the exact saved pilot'),
      { code: 'PILOT_ATTEMPT_MISMATCH', status: 409 });
    const attempt = await this.repository.getLatestLockedStageAttempt({ workflowId, ...scope, stage: 'FIRST_VIDEO' });
    if (attempt?.id !== attemptId || typeof attempt.result?.accepted !== 'boolean') throw Object.assign(new Error('Completed pilot evidence is required'),
      { code: 'PILOT_RESULT_EVIDENCE_REQUIRED', status: 409 });
    await this.repository.recordFirstVideoResult({ workflowId, ...scope, attemptId, accepted: attempt.result.accepted });
    return this.state({ id, brandId });
  }
}

module.exports = { HardenedQualityScriptFirstService };
