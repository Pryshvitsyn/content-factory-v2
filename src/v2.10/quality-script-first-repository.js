'use strict';

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
  return deterministicLocalFailure || isKnownPreRequestSemanticTierFailure(attempt, stage);
}

class HardenedQualityScriptFirstPostgresRepository extends QualityScriptFirstPostgresRepository {
  async recordQualityApproval(args) {
    if (args.decision === 'APPROVED') {
      const existing = await this.db.query(`SELECT * FROM v2_10.quality_stage_approval_events
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
          AND subject_fingerprint=$5 AND decision='APPROVED'
        ORDER BY decided_at DESC,id DESC LIMIT 1`,
      [args.draftId, args.workspaceId, args.brandId, args.stage, args.subjectFingerprint]);
      if (existing.rows[0]) return existing.rows[0];
    }
    return super.recordQualityApproval(args);
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
      const blockingActive = active.rows.find((row) => !isKnownPreRequestSemanticTierFailure(row, stage));
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