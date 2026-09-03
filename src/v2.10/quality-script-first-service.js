'use strict';

const { canonicalCreativeBrief, fingerprint } = require('./creative-contract');
const {
  QualityDirectorError,
  assertApprovedGate,
  buildScriptScaffold,
  buildStoryboardScaffold,
  canonicalScript,
  canonicalStoryboard,
  validateScript,
  validateStoryboard,
} = require('./quality-script-first-contract');

function publicRevision(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    revision: Number(row.revision),
    fingerprint: row.fingerprint,
    content: row.content,
    validation: row.validation,
    createdBy: row.created_by,
    createdAt: row.created_at,
    immutable: true,
  });
}

class QualityScriptFirstService {
  constructor({ repository, brandRepository, actor = 'local-operator' } = {}) {
    if (!repository || !brandRepository) throw new Error('quality script-first repository and brandRepository are required');
    this.repository = repository;
    this.brandRepository = brandRepository;
    this.actor = actor;
  }

  async scope(brandId) {
    const brand = await this.brandRepository.getBrand(brandId);
    if (!brand) throw new QualityDirectorError('BRAND_NOT_FOUND', 'Brand not found', null, 404);
    return { brandId, workspaceId: brand.workspaceId };
  }

  async draft(id, scope) {
    const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new QualityDirectorError('DRAFT_NOT_FOUND', 'Creative draft not found', null, 404);
    if (draft.status === 'STARTED') throw new QualityDirectorError('QUALITY_DIRECTOR_ALREADY_STARTED',
      'A started production cannot change script-first creative truth');
    return draft;
  }

  async state({ id, brandId }) {
    const scope = await this.scope(brandId);
    await this.draft(id, scope);
    return this.repository.getQualityDirectorState({ draftId: id, ...scope });
  }

  async generateScript({ id, brandId }) {
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const script = buildScriptScaffold(draft.creative_brief);
    const validation = validateScript(script, draft.creative_brief);
    return Object.freeze({ script, validation, externalCalls: 0, editableScaffold: true,
      nextRequiredAction: 'EDIT_AND_SAVE_SCRIPT' });
  }

  async saveScript({ id, brandId, script: raw }) {
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const script = canonicalScript(raw, draft.creative_brief);
    const validation = validateScript(script, draft.creative_brief);
    const saved = await this.repository.saveQualityScriptRevision({ draftId: id, ...scope,
      script, validation, actor: this.actor });
    await this.repository.invalidateQualityStages({ draftId: id, ...scope, fromStage: 'STORYBOARD',
      reason: 'SCRIPT_REVISION_CHANGED', actor: this.actor });
    return Object.freeze({ script: publicRevision(saved), approvalRequired: true,
      validation, downstreamInvalidated: true, externalCalls: 0 });
  }

  async approveScript({ id, brandId, scriptRevisionId = null, confirmation, reason = null }) {
    if (confirmation !== true) throw new QualityDirectorError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit script approval is required');
    const scope = await this.scope(brandId);
    await this.draft(id, scope);
    const row = scriptRevisionId
      ? await this.repository.getQualityScriptRevision({ id: scriptRevisionId, draftId: id, ...scope })
      : await this.repository.getLatestQualityScript({ draftId: id, ...scope });
    if (!row) throw new QualityDirectorError('SCRIPT_REVISION_REQUIRED', 'Save a script revision before approval');
    if (row.validation?.status !== 'PASS') throw new QualityDirectorError('SCRIPT_INCOMPLETE',
      'Script must pass deterministic completeness before approval', row.validation, 422);
    const event = await this.repository.recordQualityApproval({ draftId: id, ...scope, stage: 'SCRIPT',
      subjectType: 'SCRIPT_REVISION', subjectId: row.id, subjectFingerprint: row.fingerprint,
      decision: 'APPROVED', reason, actor: this.actor });
    await this.repository.invalidateQualityStages({ draftId: id, ...scope, fromStage: 'STORYBOARD',
      reason: 'SCRIPT_APPROVED_NEW_TRUTH', actor: this.actor });
    return Object.freeze({ approved: true, stage: 'SCRIPT', revision: publicRevision(row), approvalEventId: event.id,
      externalCalls: 0, nextRequiredAction: 'GENERATE_OR_EDIT_STORYBOARD' });
  }

  async generateStoryboard({ id, brandId }) {
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    assertApprovedGate(state, ['SCRIPT']);
    const script = state.script.revision.content;
    const storyboard = buildStoryboardScaffold(draft.creative_brief, script);
    const validation = validateStoryboard(storyboard, draft.creative_brief, script);
    return Object.freeze({ storyboard, validation, externalCalls: 0, editableScaffold: true,
      nextRequiredAction: 'EDIT_AND_SAVE_STORYBOARD' });
  }

  async saveStoryboard({ id, brandId, storyboard: raw }) {
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    assertApprovedGate(state, ['SCRIPT']);
    const script = state.script.revision.content;
    const storyboard = canonicalStoryboard(raw, draft.creative_brief, script);
    const validation = validateStoryboard(storyboard, draft.creative_brief, script);
    if (storyboard.scriptFingerprint !== state.script.fingerprint) {
      throw new QualityDirectorError('STORYBOARD_SCRIPT_MISMATCH',
        'Storyboard must be regenerated or rebased on the currently approved script');
    }
    const saved = await this.repository.saveQualityStoryboardRevision({ draftId: id, ...scope,
      scriptRevisionId: state.script.revision.id, storyboard, validation, actor: this.actor });
    await this.repository.invalidateQualityStages({ draftId: id, ...scope, fromStage: 'LOOK',
      reason: 'STORYBOARD_REVISION_CHANGED', actor: this.actor });
    return Object.freeze({ storyboard: publicRevision(saved), approvalRequired: true,
      validation, downstreamInvalidated: true, externalCalls: 0 });
  }

  async approveStoryboard({ id, brandId, storyboardRevisionId = null, confirmation, reason = null }) {
    if (confirmation !== true) throw new QualityDirectorError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit storyboard approval is required');
    const scope = await this.scope(brandId);
    const draft = await this.draft(id, scope);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    assertApprovedGate(state, ['SCRIPT']);
    const row = storyboardRevisionId
      ? await this.repository.getQualityStoryboardRevision({ id: storyboardRevisionId, draftId: id, ...scope })
      : await this.repository.getLatestQualityStoryboard({ draftId: id, ...scope });
    if (!row) throw new QualityDirectorError('STORYBOARD_REVISION_REQUIRED', 'Save a storyboard revision before approval');
    if (row.validation?.status !== 'PASS') throw new QualityDirectorError('STORYBOARD_INCOMPLETE',
      'Storyboard must pass deterministic completeness before approval', row.validation, 422);
    if (row.content?.scriptFingerprint !== state.script.fingerprint) throw new QualityDirectorError('STORYBOARD_SCRIPT_MISMATCH',
      'Storyboard is not based on the currently approved script');

    const updatedBrief = this.applyStoryboardToBrief(draft.creative_brief, row.content, state.script.revision.content);
    const updatedDraft = await this.repository.applyApprovedQualityStoryboard({ id, ...scope, brief: updatedBrief });
    if (!updatedDraft) throw new QualityDirectorError('STORYBOARD_BINDING_REJECTED',
      'Approved storyboard could not be bound to the canonical creative draft');
    const event = await this.repository.recordQualityApproval({ draftId: id, ...scope, stage: 'STORYBOARD',
      subjectType: 'STORYBOARD_REVISION', subjectId: row.id, subjectFingerprint: row.fingerprint,
      decision: 'APPROVED', reason, actor: this.actor });
    await this.repository.invalidateQualityStages({ draftId: id, ...scope, fromStage: 'LOOK',
      reason: 'STORYBOARD_APPROVED_NEW_TRUTH', actor: this.actor });
    return Object.freeze({ approved: true, stage: 'STORYBOARD', revision: publicRevision(row),
      approvalEventId: event.id, draftRevision: updatedDraft.revision, productionPreflightInvalidated: true,
      externalCalls: 0, nextRequiredAction: 'CREATE_VISUAL_LOCK' });
  }

  applyStoryboardToBrief(briefInput, storyboard, script) {
    const brief = canonicalCreativeBrief(briefInput);
    const byId = new Map(storyboard.shots.map((shot) => [shot.shotId, shot]));
    const shots = brief.storyboard.map((legacy) => {
      const shot = byId.get(legacy.shotId);
      if (!shot) return legacy;
      const transition = shot.transitionFromPrevious;
      return {
        ...legacy,
        durationSeconds: shot.durationSeconds,
        purpose: shot.purpose,
        subject: shot.subject,
        action: shot.action,
        environment: shot.environment,
        framing: shot.camera.framing,
        camera: shot.camera.movement,
        lensComposition: [shot.camera.angle, shot.camera.lensIntent, shot.camera.composition].filter(Boolean).join('; '),
        lighting: shot.lighting,
        startState: shot.startState,
        intendedEndState: shot.intendedEndState,
        mustKeep: shot.mustKeep,
        mayChange: shot.mayChange,
        transitionFromPrevious: transition,
        transitionToNext: shot.transitionToNext,
        transitionIntent: `${transition}: ${shot.purpose}`,
        referencePolicy: transition === 'CONTINUOUS' ? 'PREVIOUS_SHOT_FRAME' : 'NONE',
        negativeGuidance: shot.negativeGuidance,
        voiceoverSegment: shot.spokenContent || legacy.voiceoverSegment,
      };
    });
    return canonicalCreativeBrief({ ...brief, storyboard: shots,
      qualityScript: script, qualityStoryboardFingerprint: fingerprint(storyboard) });
  }

  async approveLook({ id, brandId, keyframe, reason = null }) {
    const scope = await this.scope(brandId);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    assertApprovedGate(state, ['SCRIPT', 'STORYBOARD']);
    const event = await this.repository.recordQualityApproval({ draftId: id, ...scope, stage: 'LOOK',
      subjectType: 'KEYFRAME', subjectId: keyframe.id,
      subjectFingerprint: fingerprint({ id: keyframe.id, version: keyframe.version,
        contentHash: keyframe.content_hash || keyframe.contentHash, storageKey: keyframe.storage_key || keyframe.storageKey }),
      decision: 'APPROVED', reason, actor: this.actor });
    return event;
  }

  async approvePilot({ id, brandId, workflowId, confirmation, reason = null }) {
    if (confirmation !== true) throw new QualityDirectorError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit human pilot approval is required');
    const scope = await this.scope(brandId);
    const state = await this.repository.getQualityDirectorState({ draftId: id, ...scope });
    assertApprovedGate(state, ['SCRIPT', 'STORYBOARD', 'LOOK']);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope });
    if (!workflow || workflow.id !== workflowId || workflow.state !== 'FIRST_VIDEO_REVIEW') {
      throw new QualityDirectorError('PILOT_REVIEW_REQUIRED', 'A semantically accepted pilot must be waiting for human review');
    }
    const attempt = await this.repository.getLatestLockedStageAttempt({ workflowId, ...scope, stage: 'FIRST_VIDEO' });
    if (!attempt || attempt.status !== 'SUCCEEDED' || attempt.result?.accepted !== true) {
      throw new QualityDirectorError('PILOT_ACCEPTED_MEDIA_REQUIRED', 'Pilot media must pass semantic validation before human approval');
    }
    const subjectFingerprint = fingerprint({ workflowId, attemptId: attempt.id,
      artifact: attempt.result?.media?.artifact, quality: attempt.result?.quality });
    const event = await this.repository.recordQualityApproval({ draftId: id, ...scope, stage: 'PILOT',
      subjectType: 'PILOT_ATTEMPT', subjectId: attempt.id, subjectFingerprint,
      decision: 'APPROVED', reason, actor: this.actor });
    const accepted = await this.repository.approvePilotWorkflow({ workflowId, ...scope, attemptId: attempt.id });
    return Object.freeze({ approved: true, stage: 'PILOT', approvalEventId: event.id,
      workflow: accepted, productionPreflightInvalidated: true, remainingProductionScheduled: false,
      nextRequiredAction: 'RUN_CONTINUATION_PREFLIGHT', humanApprovalRequired: true, autoPublish: false });
  }

  async rejectPilot({ id, brandId, workflowId, confirmation, reason = null }) {
    if (confirmation !== true) throw new QualityDirectorError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit pilot rejection is required');
    const scope = await this.scope(brandId);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope });
    if (!workflow || workflow.id !== workflowId || workflow.state !== 'FIRST_VIDEO_REVIEW') {
      throw new QualityDirectorError('PILOT_REVIEW_REQUIRED', 'Pilot must be waiting for human review');
    }
    const attempt = await this.repository.getLatestLockedStageAttempt({ workflowId, ...scope, stage: 'FIRST_VIDEO' });
    if (!attempt) throw new QualityDirectorError('PILOT_ATTEMPT_REQUIRED', 'Pilot attempt not found');
    const event = await this.repository.recordQualityApproval({ draftId: id, ...scope, stage: 'PILOT',
      subjectType: 'PILOT_ATTEMPT', subjectId: attempt.id,
      subjectFingerprint: fingerprint({ workflowId, attemptId: attempt.id, artifact: attempt.result?.media?.artifact }),
      decision: 'REJECTED', reason, actor: this.actor });
    const rejected = await this.repository.rejectPilotWorkflow({ workflowId, ...scope });
    return Object.freeze({ approved: false, rejected: true, approvalEventId: event.id, workflow: rejected,
      remainingProductionScheduled: false, nextRequiredAction: 'FIX_PILOT_SHOT' });
  }
}

module.exports = { QualityScriptFirstService, publicRevision };
