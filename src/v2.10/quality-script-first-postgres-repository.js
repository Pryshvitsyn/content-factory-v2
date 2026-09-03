'use strict';

const crypto = require('node:crypto');
const { V210PostgresRepository } = require('./postgres-repository');
const { fingerprint } = require('./creative-contract');
const { assertApprovedGate, QualityDirectorError } = require('./quality-script-first-contract');

function conflict(code, message, details = null) {
  return Object.assign(new Error(message), { code, status: 409, details });
}

const STAGE_ORDER = Object.freeze(['SCRIPT', 'STORYBOARD', 'LOOK', 'PILOT']);

class QualityScriptFirstPostgresRepository extends V210PostgresRepository {
  async saveCreativeIngestion({ workspaceId, brandId, mode, normalized, actor }) {
    const result = await this.db.query(`INSERT INTO v2_10.creative_ingestions (workspace_id,brand_id,mode,normalized_brief,source_metadata,missing_fields,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [workspaceId, brandId, mode, normalized.brief, normalized.sourceMetadata || {}, normalized.missing || [], actor]);
    return result.rows[0];
  }
  async saveCreativeReference({ workspaceId, brandId, draftId, reference }) {
    const result = await this.db.query(`INSERT INTO v2_10.creative_references (draft_id,workspace_id,brand_id,original_filename,media_type,content_hash,storage_key,reference_role,target_shot_id,operator_note,uploaded_by,uploaded_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (workspace_id,brand_id,content_hash,storage_key) DO NOTHING RETURNING *`,
      [draftId,workspaceId,brandId,reference.originalFilename,reference.mediaType,reference.contentHash,reference.storageKey,reference.role,reference.targetShotId,reference.note,reference.actor,reference.uploadedAt]);
    return result.rows[0] || (await this.db.query('SELECT * FROM v2_10.creative_references WHERE workspace_id=$1 AND brand_id=$2 AND content_hash=$3 AND storage_key=$4', [workspaceId,brandId,reference.contentHash,reference.storageKey])).rows[0];
  }
  async saveQualityScriptRevision({ draftId, workspaceId, brandId, script, validation, actor }) {
    const contentFingerprint = fingerprint(script);
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`quality-script:${draftId}`]);
      const prior = await client.query('SELECT coalesce(max(revision),0) AS revision FROM v2_10.quality_script_revisions WHERE draft_id=$1', [draftId]);
      const revision = Number(prior.rows[0]?.revision || 0) + 1;
      const inserted = await client.query(`INSERT INTO v2_10.quality_script_revisions
        (draft_id,workspace_id,brand_id,revision,fingerprint,content,validation,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(draft_id,fingerprint) DO NOTHING RETURNING *`,
      [draftId, workspaceId, brandId, revision, contentFingerprint, script, validation, actor]);
      const row = inserted.rows[0] || (await client.query(`SELECT * FROM v2_10.quality_script_revisions
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND fingerprint=$4`,
      [draftId, workspaceId, brandId, contentFingerprint])).rows[0];
      await client.query('COMMIT');
      return row;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async getLatestQualityScript({ draftId, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.quality_script_revisions
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 ORDER BY revision DESC LIMIT 1`,
    [draftId, workspaceId, brandId]);
    return result.rows[0] || null;
  }

  async getQualityScriptRevision({ id, draftId, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.quality_script_revisions
      WHERE id=$1 AND draft_id=$2 AND workspace_id=$3 AND brand_id=$4`, [id, draftId, workspaceId, brandId]);
    return result.rows[0] || null;
  }

  async saveQualityStoryboardRevision({ draftId, workspaceId, brandId, scriptRevisionId, storyboard, validation, actor }) {
    const contentFingerprint = fingerprint(storyboard);
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`quality-storyboard:${draftId}`]);
      const prior = await client.query('SELECT coalesce(max(revision),0) AS revision FROM v2_10.quality_storyboard_revisions WHERE draft_id=$1', [draftId]);
      const revision = Number(prior.rows[0]?.revision || 0) + 1;
      const inserted = await client.query(`INSERT INTO v2_10.quality_storyboard_revisions
        (draft_id,workspace_id,brand_id,script_revision_id,revision,fingerprint,content,validation,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(draft_id,fingerprint) DO NOTHING RETURNING *`,
      [draftId, workspaceId, brandId, scriptRevisionId, revision, contentFingerprint, storyboard, validation, actor]);
      const row = inserted.rows[0] || (await client.query(`SELECT * FROM v2_10.quality_storyboard_revisions
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND fingerprint=$4`,
      [draftId, workspaceId, brandId, contentFingerprint])).rows[0];
      await client.query('COMMIT');
      return row;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async getLatestQualityStoryboard({ draftId, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.quality_storyboard_revisions
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 ORDER BY revision DESC LIMIT 1`,
    [draftId, workspaceId, brandId]);
    return result.rows[0] || null;
  }

  async getQualityStoryboardRevision({ id, draftId, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.quality_storyboard_revisions
      WHERE id=$1 AND draft_id=$2 AND workspace_id=$3 AND brand_id=$4`, [id, draftId, workspaceId, brandId]);
    return result.rows[0] || null;
  }

  async recordQualityApproval({ draftId, workspaceId, brandId, stage, subjectType, subjectId,
    subjectFingerprint, decision, reason = null, actor }) {
    const result = await this.db.query(`INSERT INTO v2_10.quality_stage_approval_events
      (draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,decision,reason,actor)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [draftId, workspaceId, brandId, stage, subjectType, subjectId, subjectFingerprint, decision, reason, actor]);
    return result.rows[0];
  }

  async latestQualityStageEvent({ draftId, workspaceId, brandId, stage }) {
    const result = await this.db.query(`SELECT * FROM v2_10.quality_stage_approval_events
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
      ORDER BY decided_at DESC,id DESC LIMIT 1`, [draftId, workspaceId, brandId, stage]);
    return result.rows[0] || null;
  }

  async invalidateQualityStages({ draftId, workspaceId, brandId, fromStage, reason, actor }) {
    const start = STAGE_ORDER.indexOf(fromStage);
    if (start < 0) throw conflict('QUALITY_STAGE_INVALID', `Unknown quality stage '${fromStage}'`);
    const invalidated = [];
    for (const stage of STAGE_ORDER.slice(start)) {
      const latest = await this.latestQualityStageEvent({ draftId, workspaceId, brandId, stage });
      if (latest?.decision === 'APPROVED') {
        const event = await this.recordQualityApproval({ draftId, workspaceId, brandId, stage,
          subjectType: latest.subject_type, subjectId: latest.subject_id, subjectFingerprint: latest.subject_fingerprint,
          decision: 'INVALIDATED', reason, actor });
        invalidated.push(event);
      }
    }
    await this.db.query(`UPDATE v2_10.creative_drafts SET status=CASE WHEN status='STARTED' THEN status ELSE 'DRAFT' END,
      final_preflight=NULL,preflight_fingerprint=NULL,preflight_request=NULL
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED'`, [draftId, workspaceId, brandId]);
    return invalidated;
  }

  async getQualityDirectorState({ draftId, workspaceId, brandId }) {
    const script = await this.getLatestQualityScript({ draftId, workspaceId, brandId });
    const storyboard = await this.getLatestQualityStoryboard({ draftId, workspaceId, brandId });
    const events = {};
    for (const stage of STAGE_ORDER) events[stage] = await this.latestQualityStageEvent({ draftId, workspaceId, brandId, stage });
    const stage = (name, revision = null) => {
      const event = events[name];
      const approved = event?.decision === 'APPROVED'
        && (!revision || event.subject_fingerprint === revision.fingerprint);
      return Object.freeze({
        approved,
        fingerprint: approved ? event.subject_fingerprint : null,
        eventId: event?.id || null,
        decision: event?.decision || null,
        revision: revision ? Object.freeze({ ...revision, content: revision.content, validation: revision.validation }) : null,
      });
    };
    return Object.freeze({
      script: stage('SCRIPT', script),
      storyboard: stage('STORYBOARD', storyboard),
      look: stage('LOOK'),
      pilot: stage('PILOT'),
      humanApprovalRequired: true,
      autoPublish: false,
    });
  }

  async assertQualityDirectorGate({ draftId, workspaceId, brandId, requiredStages = ['SCRIPT', 'STORYBOARD'] }) {
    const state = await this.getQualityDirectorState({ draftId, workspaceId, brandId });
    assertApprovedGate(state, requiredStages);
    return state;
  }

  async applyApprovedQualityStoryboard({ id, workspaceId, brandId, brief }) {
    const result = await this.db.query(`UPDATE v2_10.creative_drafts SET creative_brief=$4,
      status='DRAFT',final_preflight=NULL,preflight_fingerprint=NULL,preflight_request=NULL
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED'
        AND coalesce(start_state,'IDLE') NOT IN ('RUNNING','NEEDS_RECONCILIATION') RETURNING *`,
    [id, workspaceId, brandId, brief]);
    return result.rows[0] || null;
  }

  async ensureLockedWorkflow({ draftId, workspaceId, brandId, shotId, assetId, canonicalIntentFingerprint, actor }) {
    const draft = (await this.db.query(`SELECT revision FROM v2_10.creative_drafts
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`, [draftId, workspaceId, brandId])).rows[0];
    if (!draft) throw conflict('DRAFT_NOT_FOUND', 'Creative draft not found');
    const productionId = crypto.randomUUID();
    await this.db.query(`INSERT INTO v2_10.locked_keyframe_workflows
      (draft_id,workspace_id,brand_id,production_id,opening_shot_id,opening_asset_id,canonical_intent_fingerprint,draft_revision,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(draft_id,opening_shot_id,canonical_intent_fingerprint) DO NOTHING`,
    [draftId, workspaceId, brandId, productionId, shotId, assetId, canonicalIntentFingerprint, Number(draft.revision), actor]);
    const result = await this.db.query(`SELECT * FROM v2_10.locked_keyframe_workflows
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND opening_shot_id=$4 AND canonical_intent_fingerprint=$5
      ORDER BY created_at DESC LIMIT 1`, [draftId, workspaceId, brandId, shotId, canonicalIntentFingerprint]);
    const row = result.rows[0];
    if (!row || row.opening_asset_id !== assetId) throw conflict('LOCKED_WORKFLOW_CONFLICT',
      'Locked-keyframe workflow could not be resolved for current approved creative intent');
    return row;
  }

  async recordFirstVideoResult({ workflowId, workspaceId, brandId, accepted, result }) {
    const state = accepted ? 'FIRST_VIDEO_REVIEW' : 'FIRST_VIDEO_FAILED';
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE v2_10.locked_keyframe_workflows SET state=$4
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND state IN ('KEYFRAME_APPROVED','FIRST_VIDEO_RUNNING') RETURNING *`,
      [workflowId, workspaceId, brandId, state]);
      if (!updated.rows[0]) throw conflict('LOCKED_WORKFLOW_STATE_CONFLICT',
        'First-video result cannot be recorded in the current workflow state');
      if (accepted) await client.query(`UPDATE v2_10.creative_drafts SET status='DRAFT',final_preflight=NULL,
        preflight_fingerprint=NULL,preflight_request=NULL WHERE id=$1 AND workspace_id=$2 AND brand_id=$3
          AND status='PREFLIGHT_READY'`, [updated.rows[0].draft_id, workspaceId, brandId]);
      await client.query('COMMIT');
      return { ...updated.rows[0], firstVideoResult: result, humanPilotApprovalRequired: accepted };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async getLatestLockedStageAttempt({ workflowId, workspaceId, brandId, stage }) {
    const result = await this.db.query(`SELECT * FROM v2_10.locked_stage_attempts
      WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
      ORDER BY started_at DESC,id DESC LIMIT 1`, [workflowId, workspaceId, brandId, stage]);
    return result.rows[0] || null;
  }

  async approvePilotWorkflow({ workflowId, workspaceId, brandId, attemptId }) {
    const attempt = await this.getLatestLockedStageAttempt({ workflowId, workspaceId, brandId, stage: 'FIRST_VIDEO' });
    if (!attempt || attempt.id !== attemptId || attempt.status !== 'SUCCEEDED' || attempt.result?.accepted !== true) {
      throw conflict('PILOT_ATTEMPT_MISMATCH', 'Exact semantically accepted pilot attempt is required');
    }
    const result = await this.db.query(`UPDATE v2_10.locked_keyframe_workflows SET state='FIRST_VIDEO_ACCEPTED'
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND state='FIRST_VIDEO_REVIEW' RETURNING *`,
    [workflowId, workspaceId, brandId]);
    if (!result.rows[0]) throw conflict('PILOT_REVIEW_STATE_CONFLICT', 'Pilot is not waiting for human approval');
    return result.rows[0];
  }

  async rejectPilotWorkflow({ workflowId, workspaceId, brandId }) {
    const result = await this.db.query(`UPDATE v2_10.locked_keyframe_workflows SET state='FIRST_VIDEO_REJECTED'
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND state='FIRST_VIDEO_REVIEW' RETURNING *`,
    [workflowId, workspaceId, brandId]);
    if (!result.rows[0]) throw conflict('PILOT_REVIEW_STATE_CONFLICT', 'Pilot is not waiting for human review');
    return result.rows[0];
  }
}

module.exports = { QualityScriptFirstPostgresRepository, STAGE_ORDER };
