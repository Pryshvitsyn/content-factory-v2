'use strict';

function stateError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function cleanText(value, max = 2000) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanStatus(value) {
  return ['PASS', 'WARN', 'FAIL'].includes(value) ? value : 'FAIL';
}

function sanitizePersistedValidation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const checks = Array.isArray(raw.checks) ? raw.checks.slice(0, 100).map((check) => Object.freeze({
    code: cleanText(check?.code, 128) || 'UNSPECIFIED_CHECK',
    status: cleanStatus(check?.status),
    reason: cleanText(check?.reason, 2000) || 'No evaluator reason was persisted.',
  })) : [];
  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? Object.freeze({
      provider: cleanText(raw.metadata.provider, 128),
      model: cleanText(raw.metadata.model, 256),
      externalCalls: Math.max(0, Math.min(1, Number(raw.metadata.externalCalls || 0))),
    })
    : Object.freeze({ provider: null, model: null, externalCalls: 0 });
  return Object.freeze({ status: cleanStatus(raw.status), checks: Object.freeze(checks), metadata });
}

function sanitizePersistedKeyframe(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return Object.freeze({
    id: cleanText(raw.id, 128),
    version: Number(raw.version || 0),
    contentHash: cleanText(raw.contentHash, 256),
    sourceType: cleanText(raw.sourceType, 64),
    provider: cleanText(raw.provider, 128),
    model: cleanText(raw.model, 256),
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    validationStatus: cleanText(raw.validationStatus, 32),
    approvalDecision: cleanText(raw.approvalDecision, 64),
    immutable: raw.immutable === true,
  });
}

function sanitizePersistedResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const validation = sanitizePersistedValidation(raw.validation);
  if (!validation) return null;
  return Object.freeze({
    keyframe: sanitizePersistedKeyframe(raw.keyframe),
    validation,
    lifecycle: cleanText(raw.lifecycle, 128),
    remainingProductionScheduled: raw.remainingProductionScheduled === true,
    humanApprovalRequired: true,
    autoPublish: false,
  });
}

class LockedKeyframeStateService {
  constructor({ db, brandRepository } = {}) {
    if (!db || !brandRepository) throw new Error('db and brandRepository are required');
    this.db = db;
    this.brandRepository = brandRepository;
  }

  async state({ draftId, brandId } = {}) {
    if (!draftId || !brandId) throw stateError(400, 'LOCKED_KEYFRAME_STATE_SCOPE_REQUIRED',
      'draftId and brandId are required');
    const brand = await this.brandRepository.getBrand(brandId);
    if (!brand) throw stateError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    const workspaceId = brand.workspaceId;
    const workflowResult = await this.db.query(`SELECT id,state,production_id,opening_shot_id,opening_asset_id
      FROM v2_10.locked_keyframe_workflows
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3
      ORDER BY created_at DESC,id DESC LIMIT 1`, [draftId, workspaceId, brandId]);
    const workflow = workflowResult.rows[0] || null;
    if (!workflow) return Object.freeze({ workflow: null, keyframeResult: null, attempt: null, externalCalls: 0 });

    const attemptResult = await this.db.query(`SELECT id,status,boundary_state,result,started_at,completed_at
      FROM v2_10.locked_stage_attempts
      WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage='KEYFRAME'
        AND result ? 'validation'
      ORDER BY started_at DESC,id DESC LIMIT 1`, [workflow.id, workspaceId, brandId]);
    const attempt = attemptResult.rows[0] || null;
    const keyframeResult = sanitizePersistedResult(attempt?.result);
    return Object.freeze({
      workflow: Object.freeze({
        id: workflow.id,
        state: workflow.state,
        productionId: workflow.production_id,
        openingShotId: workflow.opening_shot_id,
        openingAssetId: workflow.opening_asset_id,
      }),
      keyframeResult,
      attempt: attempt ? Object.freeze({
        id: attempt.id,
        status: attempt.status,
        boundaryState: attempt.boundary_state,
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
      }) : null,
      externalCalls: 0,
    });
  }
}

module.exports = {
  LockedKeyframeStateService,
  sanitizePersistedKeyframe,
  sanitizePersistedResult,
  sanitizePersistedValidation,
};
