'use strict';

const { legacyResolutionRejection, rejectedBeforeCreation } = require('../providers/execution-outcome');
const { QualityScriptFirstPostgresRepository } = require('./quality-script-first-postgres-repository');

const SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES = Object.freeze([
  'KEYFRAME_GEOMETRY_MISMATCH',
  'KEYFRAME_TYPE_UNSUPPORTED',
  'KEYFRAME_SIZE_INVALID',
]);
const LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR = 'Unsupported quality tier QUALITY';

function lockedStageConflict(message = 'This immutable stage preflight already has an active, failed, or ambiguous attempt') {
  return Object.assign(new Error(message), { code: 'LOCKED_STAGE_ALREADY_ATTEMPTED', status: 409 });
}

function isKnownPreRequestSemanticTierFailure(attempt, stage) {
  return stage === 'KEYFRAME'
    && attempt?.status === 'NEEDS_RECONCILIATION'
    && attempt?.boundary_state === 'MAY_HAVE_STARTED'
    && !attempt?.provider_request_id
    && attempt?.error?.code === 'KEYFRAME_STAGE_FAILED'
    && attempt?.error?.message === LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR;
}

function isSafeLocalLockedStageRetry(attempt, stage) {
  const deterministicLocalFailure = stage === 'KEYFRAME'
    && attempt?.status === 'FAILED'
    && attempt?.boundary_state === 'NOT_CROSSED'
    && SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES.includes(attempt?.error?.code);
  return deterministicLocalFailure || isKnownPreRequestSemanticTierFailure(attempt, stage)
    || (stage === 'FIRST_VIDEO' && attempt?.status === 'FAILED' && attempt?.boundary_state === 'NOT_CROSSED'
      && rejectedBeforeCreation(attempt.error, attempt.provider_request_id));
}

class HardenedQualityScriptFirstPostgresRepository extends QualityScriptFirstPostgresRepository {
  async decidePilot({ draftId, workspaceId, brandId, workflowId, attemptId, decision, actor, reason }) {
    if (!attemptId || !['APPROVED','REJECTED'].includes(decision)) throw Object.assign(new Error('Review the exact current pilot first'),
      { code: 'PILOT_ATTEMPT_MISMATCH', status: 409 });
    const scope = { draftId, workspaceId, brandId };
    const stale = () => Object.assign(new Error('Pilot or approvals changed. Reload and review the current pilot.'),
      { code: 'PILOT_ATTEMPT_MISMATCH', status: 409 });
    const attempt = await this.getLatestLockedStageAttempt({ workflowId, workspaceId, brandId, stage: 'FIRST_VIDEO' });
    if (attempt?.id !== attemptId) throw stale();
    const target = decision === 'APPROVED' ? 'FIRST_VIDEO_ACCEPTED' : 'FIRST_VIDEO_REJECTED';
    let workflow;
    const event = await this.recordQualityApproval({ ...scope, stage: 'PILOT', subjectType: 'PILOT_ATTEMPT',
      subjectId: attemptId, subjectFingerprint: require('./creative-contract').fingerprint({ workflowId, attemptId,
        artifact: attempt.result?.media?.artifact, quality: attempt.result?.quality }), decision, actor, reason,
      verifyCurrent: async client => {
        const reader = Object.create(this); reader.db = client;
        workflow = (await client.query(`SELECT * FROM v2_10.locked_keyframe_workflows
          WHERE id=$1 AND draft_id=$2 AND workspace_id=$3 AND brand_id=$4 FOR UPDATE`,
        [workflowId, draftId, workspaceId, brandId])).rows[0];
        const current = await reader.getLatestLockedStageAttempt({ workflowId, workspaceId, brandId, stage: 'FIRST_VIDEO' });
        if (!workflow || !['FIRST_VIDEO_REVIEW',target].includes(workflow.state) || current?.id !== attemptId
          || current.status !== 'SUCCEEDED' || current.result?.accepted !== true) throw stale();
        await reader.assertQualityDirectorGate({ ...scope, requiredStages: ['SCRIPT','STORYBOARD','LOOK'] });
      },
      afterApprovalChanged: async client => {
        workflow = (await client.query(`UPDATE v2_10.locked_keyframe_workflows SET state=$5
          WHERE id=$1 AND draft_id=$2 AND workspace_id=$3 AND brand_id=$4 RETURNING *`,
        [workflowId, draftId, workspaceId, brandId, target])).rows[0];
        await client.query(`UPDATE v2_10.creative_drafts SET status='DRAFT',final_preflight=NULL,
          preflight_fingerprint=NULL,preflight_request=NULL
          WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED'`, [draftId,workspaceId,brandId]);
      } });
    return { event, workflow };
  }

  async recordQualityApproval(args) {
    return require('./quality-approval-events').recordQualityApproval(this.db, args);
  }

  async getQualityDirectorState(args) {
    const state = await super.getQualityDirectorState(args);
    const draft = await this.getDraft({ id: args.draftId, ...args });
    if (!draft) return { ...state, look: { approved: false, fingerprint: null, status: 'BLOCKED_UPSTREAM' } };
    const workflow = await this.getLockedWorkflow(args);
    const opening = draft.creative_brief?.storyboard?.[0];
    let keyframe = null;
    if (workflow && workflow.opening_shot_id === opening?.shotId) {
      const rows = await this.db.query(`SELECT id FROM v2_10.keyframe_artifacts
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND shot_id=$4 AND asset_id=$5
        ORDER BY created_at DESC,version DESC LIMIT 1`,
      [workflow.id, args.workspaceId, args.brandId, opening.shotId, opening.assetId]);
      if (rows.rows[0]) keyframe = await this.getKeyframe({ id: rows.rows[0].id, ...args });
    }
    const event = await this.latestQualityStageEvent({ ...args, stage: 'LOOK' });
    const look = require('./quality-look-lifecycle').describeLook(state, keyframe, opening?.referenceMedia, event);
    return Object.freeze({ ...state, look,
      pilot: look.approved ? state.pilot : { ...state.pilot, approved: false, fingerprint: null } });
  }

  async recordCurrentLookApproval({ draftId, workspaceId, brandId, keyframeId, expectedFingerprint, actor, reason }) {
    const scope = { draftId, workspaceId, brandId };
    const error = () => Object.assign(new Error('LOOK context changed. Reload and review the current frame and storyboard.'),
      { code: 'STALE_LOOK_APPROVAL', status: 409 });
    return this.recordQualityApproval({ ...scope, stage: 'LOOK', subjectType: 'KEYFRAME',
      subjectId: keyframeId, subjectFingerprint: expectedFingerprint, decision: 'APPROVED', actor, reason,
      verifyCurrent: async (client) => {
        const reader = Object.create(this); reader.db = client;
        const state = await reader.getQualityDirectorState(scope);
        if (!state.look.canApprove || state.look.keyframeId !== keyframeId
          || state.look.expectedFingerprint !== expectedFingerprint) throw error();
        const draft = await reader.getDraft({ id: draftId, workspaceId, brandId });
        if (draft.status === 'STARTED' || ['RUNNING','NEEDS_RECONCILIATION'].includes(draft.start_state)) throw error();
      },
      afterApprovalChanged: async (client) => {
        // Append an invalidation; never rewrite immutable decisions or media.
        await client.query(`INSERT INTO v2_10.quality_stage_approval_events
          (draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,decision,reason,actor)
          SELECT draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,
            'INVALIDATED','LOOK_APPROVED_NEW_CONTEXT',$4 FROM (
              SELECT * FROM v2_10.quality_stage_approval_events
              WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage='PILOT'
              ORDER BY decided_at DESC,id DESC LIMIT 1) p WHERE p.decision='APPROVED'`,
        [draftId,workspaceId,brandId,actor]);
        await client.query(`UPDATE v2_10.creative_drafts SET status='DRAFT',final_preflight=NULL,
          preflight_fingerprint=NULL,preflight_request=NULL
          WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED'`, [draftId,workspaceId,brandId]);
      } });
  }

  async markLockedContinuationStarted({ draftId,workspaceId,brandId,productionId }) {
    const result = await this.db.query(`UPDATE v2_10.locked_keyframe_workflows w SET state='CONTINUATION_STARTED'
      WHERE w.draft_id=$1 AND w.workspace_id=$2 AND w.brand_id=$3 AND w.state='FIRST_VIDEO_ACCEPTED'
        AND (SELECT a.status='SUCCEEDED' AND a.result->>'productionId'=$4::text
          AND a.result->>'accepted'='true'
          FROM v2_10.locked_stage_attempts a WHERE a.workflow_id=w.id
            AND a.workspace_id=w.workspace_id AND a.brand_id=w.brand_id AND a.stage='FIRST_VIDEO'
          ORDER BY a.started_at DESC,a.id DESC LIMIT 1) RETURNING w.*`,
    [draftId,workspaceId,brandId,productionId]);
    return result.rows[0] || null;
  }

  async assertLockedStageAvailable({ workflowId,workspaceId,brandId,stage }) {
    const result = await this.db.query(`SELECT * FROM v2_10.locked_stage_attempts
      WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
        AND status IN ('RUNNING','NEEDS_RECONCILIATION')`, [workflowId,workspaceId,brandId,stage]);
    const pending = result.rows.find(row => !isKnownPreRequestSemanticTierFailure(row,stage) && !legacyResolutionRejection(row));
    if (pending) throw Object.assign(lockedStageConflict('Previous stage attempt needs reconciliation before preflight can be READY.'),
      { details: { attemptId: pending.id, status: pending.status } });
    return { available: true, providerCalls: 0 };
  }

  async claimLockedStage({ workflowId, workspaceId, brandId, stage, preflightId }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    const ownsTransaction = client !== this.db;
    try {
      if (ownsTransaction) {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`locked-stage:${workflowId}:${stage}`]);
      }

      const active = await client.query(`SELECT * FROM v2_10.locked_stage_attempts
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
          AND status IN ('RUNNING','NEEDS_RECONCILIATION')
        ORDER BY started_at DESC,id DESC`,
      [workflowId, workspaceId, brandId, stage]);
      const blockingActive = active.rows.find((row) => !isKnownPreRequestSemanticTierFailure(row, stage) && !legacyResolutionRejection(row));
      if (blockingActive) throw lockedStageConflict();

      const latest = await client.query(`SELECT * FROM v2_10.locked_stage_attempts
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4 AND preflight_id=$5
        ORDER BY started_at DESC,id DESC LIMIT 1`,
      [workflowId, workspaceId, brandId, stage, preflightId]);
      const prior = latest.rows[0] || null;

      if (prior?.status === 'SUCCEEDED') {
        if (ownsTransaction) await client.query('COMMIT');
        return Object.freeze({ ...prior, reused: true });
      }

      const safeLocalRetry = isSafeLocalLockedStageRetry(prior, stage);
      if (prior && !safeLocalRetry) throw lockedStageConflict();

      const inserted = await client.query(`INSERT INTO v2_10.locked_stage_attempts
        (workflow_id,workspace_id,brand_id,stage,preflight_id,status,boundary_state)
        VALUES($1,$2,$3,$4,$5,'RUNNING','NOT_CROSSED') RETURNING *`,
      [workflowId, workspaceId, brandId, stage, preflightId]);
      if (!inserted.rows[0]) throw lockedStageConflict('Locked-stage attempt could not be claimed');

      if (ownsTransaction) await client.query('COMMIT');
      return Object.freeze({
        ...inserted.rows[0],
        reused: false,
        safeLocalRetry,
        retryOfAttemptId: safeLocalRetry ? prior.id : null,
      });
    } catch (error) {
      if (ownsTransaction) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  async getLockedWorkflow({ draftId, workspaceId, brandId, shotId = null, canonicalIntentFingerprint = null }) {
    try {
      const result = await this.db.query(`SELECT * FROM v2_10.locked_keyframe_workflows
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3
          AND ($4::text IS NULL OR opening_shot_id=$4)
          AND ($5::text IS NULL OR canonical_intent_fingerprint=$5)
        ORDER BY created_at DESC,id DESC LIMIT 1`,
      [draftId, workspaceId, brandId, shotId, canonicalIntentFingerprint]);
      return result.rows[0] || null;
    } catch (error) {
      if (['42P01','3F000'].includes(error.code)) return null;
      throw error;
    }
  }
}

module.exports = {
  HardenedQualityScriptFirstPostgresRepository,
  LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR,
  SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES,
  isKnownPreRequestSemanticTierFailure,
  isSafeLocalLockedStageRetry,
};
