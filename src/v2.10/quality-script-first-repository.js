'use strict';

const { QualityScriptFirstPostgresRepository } = require('./quality-script-first-postgres-repository');

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

module.exports = { HardenedQualityScriptFirstPostgresRepository };
