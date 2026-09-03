'use strict';

const { QualityScriptFirstPostgresRepository } = require('./quality-script-first-postgres-repository');

const SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES = Object.freeze([
  'KEYFRAME_GEOMETRY_MISMATCH',
  'KEYFRAME_TYPE_UNSUPPORTED',
  'KEYFRAME_SIZE_INVALID',
]);

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

  async claimLockedStage(args) {
    try {
      return await super.claimLockedStage(args);
    } catch (error) {
      if (error?.code !== 'LOCKED_STAGE_ALREADY_ATTEMPTED') throw error;
      const retried = await this.db.query(`UPDATE v2_10.locked_stage_attempts
        SET status='RUNNING',boundary_state='NOT_CROSSED',provider_request_id=NULL,keyframe_id=NULL,
          result='{}'::jsonb,error='{}'::jsonb,completed_at=NULL,started_at=now()
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4 AND preflight_id=$5
          AND status='FAILED' AND boundary_state='NOT_CROSSED'
          AND coalesce(error->>'code','') = ANY($6::text[])
        RETURNING *`,
      [args.workflowId, args.workspaceId, args.brandId, args.stage, args.preflightId,
        SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES]);
      if (retried.rows[0]) return Object.freeze({ ...retried.rows[0], reused: false, safeLocalRetry: true });
      throw error;
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

module.exports = { HardenedQualityScriptFirstPostgresRepository, SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES };
