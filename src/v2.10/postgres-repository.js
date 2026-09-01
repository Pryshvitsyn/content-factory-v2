'use strict';
const crypto = require('node:crypto');

function conflict(code, message) { return Object.assign(new Error(message), { code }); }

class V210PostgresRepository {
  constructor({ db, storage = null }) { if (!db) throw new Error('db is required'); this.db = db; this.storage = storage; }
  async createDraft({ workspaceId, brandId, brief, validation, providerSelection = {}, voiceSelection = {}, actor }) {
    const result = await this.db.query(`INSERT INTO v2_10.creative_drafts
      (workspace_id,brand_id,creative_schema_version,status,creative_brief,creative_validation,provider_selection,voice_selection,created_by)
      VALUES ($1,$2,'2.10',$3,$4,$5,$6,$7,$8) RETURNING *`, [workspaceId, brandId,
      validation.status === 'FAIL' ? 'CREATIVE_INCOMPLETE' : 'DRAFT', brief, validation, providerSelection, voiceSelection, actor]);
    return result.rows[0];
  }
  async getDraft({ id, workspaceId, brandId }) {
    const result = await this.db.query('SELECT * FROM v2_10.creative_drafts WHERE id=$1 AND workspace_id=$2 AND brand_id=$3', [id, workspaceId, brandId]);
    return result.rows[0] || null;
  }
  async updateDraft({ id, workspaceId, brandId, brief, validation, providerSelection, voiceSelection, voiceApproval }) {
    const result = await this.db.query(`UPDATE v2_10.creative_drafts SET creative_brief=$4,creative_validation=$5,
      provider_selection=coalesce($6::jsonb,provider_selection),voice_selection=coalesce($7::jsonb,voice_selection),
      voice_approval=coalesce($8::jsonb,voice_approval),
      status=CASE WHEN creative_brief IS DISTINCT FROM $4
        OR provider_selection IS DISTINCT FROM coalesce($6::jsonb,provider_selection)
        OR voice_selection IS DISTINCT FROM coalesce($7::jsonb,voice_selection)
        OR voice_approval IS DISTINCT FROM coalesce($8::jsonb,voice_approval)
        THEN $9 ELSE status END
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3
        AND coalesce(start_state,'IDLE') NOT IN ('RUNNING','NEEDS_RECONCILIATION') AND status<>'STARTED' RETURNING *`,
    [id, workspaceId, brandId, brief, validation,
      providerSelection === undefined ? null : providerSelection, voiceSelection === undefined ? null : voiceSelection,
      voiceApproval === undefined ? null : voiceApproval, validation.status === 'FAIL' ? 'CREATIVE_INCOMPLETE' : 'DRAFT']);
    return result.rows[0] || null;
  }
  async savePreflight({ id, workspaceId, brandId, preflight, preflightRequest, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE v2_10.creative_drafts SET final_preflight=$4,preflight_fingerprint=$5,
        preflight_request=$6,status='PREFLIGHT_READY',start_state='IDLE',last_start_error=NULL,reconciliation_required_at=NULL
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED'
          AND coalesce(start_state,'IDLE') NOT IN ('RUNNING','NEEDS_RECONCILIATION') RETURNING *`,
      [id, workspaceId, brandId, preflight, preflight.fingerprint, preflightRequest || {}]);
      if (!updated.rows[0]) throw conflict('PREFLIGHT_SAVE_REJECTED', 'Creative draft is not eligible for a new preflight');
      await client.query(`INSERT INTO v2_10.preflight_events(draft_id,workspace_id,brand_id,draft_revision,fingerprint,result,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [id, workspaceId, brandId,
        updated.rows[0].revision, preflight.fingerprint, preflight, actor]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async findVoicePreview({ workspaceId, brandId, fingerprint }) {
    const result = await this.db.query('SELECT * FROM v2_10.voice_preview_artifacts WHERE workspace_id=$1 AND brand_id=$2 AND preview_fingerprint=$3', [workspaceId, brandId, fingerprint]);
    return result.rows[0] || null;
  }
  async getVoicePreview({ id, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.voice_preview_artifacts
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`, [id, workspaceId, brandId]);
    return result.rows[0] || null;
  }
  async storeVoicePreview(value) {
    if (!this.storage || !Buffer.isBuffer(value.bytes)) throw new Error('Immutable preview storage and generated audio bytes are required');
    const contentHash = crypto.createHash('sha256').update(value.bytes).digest('hex');
    const storageKey = `workspaces/${value.workspaceId}/brands/${value.brandId}/voice-previews/${contentHash}`;
    if (!(await this.storage.exists({ key: storageKey }))) {
      await this.storage.put({ key: storageKey, bytes: value.bytes, metadata: { contentType: value.contentType, immutable: true } });
    }
    const result = await this.db.query(`INSERT INTO v2_10.voice_preview_artifacts
      (workspace_id,brand_id,preview_fingerprint,provider,model,voice_id,configuration,preview_text_hash,storage_key,content_hash,content_type,duration_seconds,external_call_count,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13) ON CONFLICT(workspace_id,brand_id,preview_fingerprint) DO NOTHING RETURNING *`,
    [value.workspaceId, value.brandId, value.fingerprint, value.voice.provider, value.voice.model, value.voice.voiceId, value.voice, value.previewTextHash,
      storageKey, contentHash, value.contentType, value.durationSeconds, value.provenance || {}]);
    return result.rows[0] || this.findVoicePreview(value);
  }
  async storeUploadedVoice(value) {
    const storageKey = `workspaces/${value.workspaceId}/brands/${value.brandId}/voice-uploads/${value.contentHash}/v1`;
    if (!(await value.storage.exists({ key: storageKey }))) {
      await value.storage.put({ key: storageKey, bytes: value.bytes, metadata: { contentType: value.contentType, immutable: true } });
    }
    const result = await this.db.query(`INSERT INTO v2_10.uploaded_voice_artifacts
      (workspace_id,brand_id,version,storage_key,content_hash,content_type,size_bytes,duration_seconds,audio_metadata,operator_attestation,provenance)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,brand_id,content_hash,version) DO NOTHING RETURNING *`,
    [value.workspaceId, value.brandId, storageKey, value.contentHash, value.contentType, value.bytes.length,
      value.metadata.durationSeconds, value.metadata, value.operatorAttestation, { source: 'OPERATOR_UPLOAD', externalCalls: 0, actor: value.actor }]);
    if (result.rows[0]) return result.rows[0];
    return (await this.db.query('SELECT * FROM v2_10.uploaded_voice_artifacts WHERE workspace_id=$1 AND brand_id=$2 AND content_hash=$3 AND version=1',
      [value.workspaceId, value.brandId, value.contentHash])).rows[0];
  }
  async getUploadedVoice({ id, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.uploaded_voice_artifacts
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`, [id, workspaceId, brandId]);
    return result.rows[0] || null;
  }
  async claimStart({ id, workspaceId, brandId, fingerprint, actor, canonicalInputFingerprint = null }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM v2_10.creative_drafts
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`, [id, workspaceId, brandId]);
      const draft = locked.rows[0];
      if (!draft) throw conflict('DRAFT_NOT_FOUND', 'Creative draft not found');
      if (draft.status === 'STARTED') { await client.query('COMMIT'); return { ...draft, reused: true }; }
      if (draft.start_state === 'RUNNING') throw conflict('START_ALREADY_RUNNING', 'A V2.10 production start is already running');
      if (draft.start_state === 'NEEDS_RECONCILIATION') throw conflict('START_NEEDS_RECONCILIATION', 'Previous V2.10 start may have crossed an external boundary; reconcile before retrying');
      if (draft.status !== 'PREFLIGHT_READY' || draft.preflight_fingerprint !== fingerprint) {
        throw conflict('START_CLAIM_REJECTED', 'Draft preflight is stale or not ready');
      }
      const attempt = Number(draft.start_attempt || 0) + 1;
      const updated = await client.query(`UPDATE v2_10.creative_drafts SET start_state='RUNNING',start_attempt=$4,
        v210_start_claimed_at=now(),last_start_error=NULL WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 RETURNING *`,
      [id, workspaceId, brandId, attempt]);
      await client.query(`INSERT INTO v2_10.start_attempts
        (draft_id,workspace_id,brand_id,attempt,status,phase,boundary_state,preflight_fingerprint,canonical_input_fingerprint,actor)
        VALUES($1,$2,$3,$4,'RUNNING','CLAIMED','NOT_CROSSED',$5,$6,$7)`,
      [id, workspaceId, brandId, attempt, fingerprint, canonicalInputFingerprint, actor]);
      await client.query('COMMIT'); return { ...updated.rows[0], startAttempt: attempt, reused: false };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async finishStartSuccess({ id, workspaceId, brandId, attempt, productionId, canonicalInputFingerprint = null }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const evidence = await client.query(`UPDATE v2_10.start_attempts SET status='SUCCEEDED',phase='CANONICAL_CREATED',
        boundary_state='CANONICAL_CREATED',production_id=$5,canonical_input_fingerprint=coalesce($6,canonical_input_fingerprint),
        completed_at=now() WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND attempt=$4 AND status='RUNNING' RETURNING id`,
      [id, workspaceId, brandId, attempt, productionId, canonicalInputFingerprint]);
      if (!evidence.rows[0]) throw conflict('START_ATTEMPT_FENCED', 'V2.10 start attempt is no longer active');
      const result = await client.query(`UPDATE v2_10.creative_drafts SET status='STARTED',start_state='SUCCEEDED',
        production_id=$4,started_at=now(),v210_start_claimed_at=NULL,last_start_error=NULL
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND start_state='RUNNING' RETURNING *`,
      [id, workspaceId, brandId, productionId]);
      if (!result.rows[0]) throw conflict('START_ATTEMPT_FENCED', 'V2.10 draft start ownership was lost');
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async finishStartFailure({ id, workspaceId, brandId, attempt, error, boundaryState = 'MAY_HAVE_STARTED',
    phase = 'START_FAILED', productionId = null }) {
    const retryable = boundaryState === 'NOT_CROSSED';
    const state = retryable ? 'FAILED_RETRYABLE' : 'NEEDS_RECONCILIATION';
    const payload = { code: error?.code || 'V210_START_FAILED', message: error?.message || 'V2.10 start failed',
      phase, boundaryState, productionId, details: error?.details || null };
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const evidence = await client.query(`UPDATE v2_10.start_attempts SET status=$5,phase=$6,boundary_state=$7,
        production_id=coalesce($8,production_id),error=$9::jsonb,completed_at=now()
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND attempt=$4 AND status='RUNNING' RETURNING id`,
      [id, workspaceId, brandId, attempt, state, phase, boundaryState, productionId, JSON.stringify(payload)]);
      if (!evidence.rows[0]) throw conflict('START_ATTEMPT_FENCED', 'V2.10 start attempt is no longer active');
      const result = await client.query(`UPDATE v2_10.creative_drafts SET start_state=$4,v210_start_claimed_at=NULL,
        last_start_error=$5::jsonb,reconciliation_required_at=CASE WHEN $4='NEEDS_RECONCILIATION' THEN now() ELSE NULL END
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND start_state='RUNNING' RETURNING *`,
      [id, workspaceId, brandId, state, JSON.stringify(payload)]);
      if (!result.rows[0]) throw conflict('START_ATTEMPT_FENCED', 'V2.10 draft start ownership was lost');
      await client.query('COMMIT'); return result.rows[0];
    } catch (cause) { await client.query('ROLLBACK').catch(() => {}); throw cause; } finally { client.release(); }
  }
  async startAttempts({ id, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT * FROM v2_10.start_attempts
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 ORDER BY attempt DESC`, [id, workspaceId, brandId]);
    return result.rows;
  }

  async ensureLockedWorkflow({ draftId, workspaceId, brandId, shotId, assetId, canonicalIntentFingerprint, actor }) {
    const productionId = crypto.randomUUID();
    await this.db.query(`INSERT INTO v2_10.locked_keyframe_workflows
      (draft_id,workspace_id,brand_id,production_id,opening_shot_id,opening_asset_id,canonical_intent_fingerprint,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(draft_id,opening_shot_id) DO NOTHING`,
    [draftId, workspaceId, brandId, productionId, shotId, assetId, canonicalIntentFingerprint, actor]);
    const result = await this.db.query(`SELECT * FROM v2_10.locked_keyframe_workflows
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND opening_shot_id=$4`,
    [draftId, workspaceId, brandId, shotId]);
    const row = result.rows[0];
    if (!row || row.opening_asset_id !== assetId || row.canonical_intent_fingerprint !== canonicalIntentFingerprint) {
      throw conflict('LOCKED_WORKFLOW_CONFLICT', 'Existing locked-keyframe workflow belongs to different canonical intent');
    }
    return row;
  }

  async getLockedWorkflow({ draftId, workspaceId, brandId, shotId = null }) {
    try {
      const result = await this.db.query(`SELECT * FROM v2_10.locked_keyframe_workflows
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND ($4::text IS NULL OR opening_shot_id=$4)
        ORDER BY created_at DESC LIMIT 1`, [draftId, workspaceId, brandId, shotId]);
      return result.rows[0] || null;
    } catch (error) {
      if (['42P01','3F000'].includes(error.code)) return null;
      throw error;
    }
  }

  async saveLockedStagePreflight({ workflowId, workspaceId, brandId, stage, draftRevision,
    keyframe = null, plan, actor }) {
    const result = await this.db.query(`INSERT INTO v2_10.locked_stage_preflights
      (workflow_id,workspace_id,brand_id,stage,draft_revision,keyframe_id,keyframe_version,
       keyframe_content_hash,fingerprint,execution_plan,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(workflow_id,stage,fingerprint) DO NOTHING RETURNING *`,
    [workflowId, workspaceId, brandId, stage, draftRevision, keyframe?.id || null,
      keyframe?.version || null, keyframe?.content_hash || null, plan.fingerprint, plan, actor]);
    if (result.rows[0]) return result.rows[0];
    return (await this.db.query(`SELECT * FROM v2_10.locked_stage_preflights
      WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4 AND fingerprint=$5`,
    [workflowId, workspaceId, brandId, stage, plan.fingerprint])).rows[0];
  }

  async getLockedStagePreflight({ id, workflowId, workspaceId, brandId, stage }) {
    const result = await this.db.query(`SELECT * FROM v2_10.locked_stage_preflights
      WHERE id=$1 AND workflow_id=$2 AND workspace_id=$3 AND brand_id=$4 AND stage=$5`,
    [id, workflowId, workspaceId, brandId, stage]);
    return result.rows[0] || null;
  }

  async claimLockedStage({ workflowId, workspaceId, brandId, stage, preflightId }) {
    const result = await this.db.query(`INSERT INTO v2_10.locked_stage_attempts
      (workflow_id,workspace_id,brand_id,stage,preflight_id,status,boundary_state)
      VALUES($1,$2,$3,$4,$5,'RUNNING','NOT_CROSSED')
      ON CONFLICT(workflow_id,stage,preflight_id) DO NOTHING RETURNING *`,
    [workflowId, workspaceId, brandId, stage, preflightId]);
    if (result.rows[0]) return result.rows[0];
    const existing = (await this.db.query(`SELECT * FROM v2_10.locked_stage_attempts
      WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4 AND preflight_id=$5`,
    [workflowId, workspaceId, brandId, stage, preflightId])).rows[0];
    if (existing?.status === 'SUCCEEDED') return { ...existing, reused: true };
    throw conflict('LOCKED_STAGE_ALREADY_ATTEMPTED', 'This immutable stage preflight already has an active, failed, or ambiguous attempt');
  }

  async markLockedStageBoundary({ attemptId, providerRequestId = null }) {
    const result = await this.db.query(`UPDATE v2_10.locked_stage_attempts
      SET boundary_state='MAY_HAVE_STARTED',provider_request_id=coalesce($2,provider_request_id)
      WHERE id=$1 AND status='RUNNING' AND boundary_state='NOT_CROSSED' RETURNING *`, [attemptId, providerRequestId]);
    if (!result.rows[0]) throw conflict('LOCKED_STAGE_FENCED', 'Locked stage lost ownership before provider boundary');
    return result.rows[0];
  }

  async recordLockedStageProviderRequest({ attemptId, providerRequestId }) {
    const result = await this.db.query(`UPDATE v2_10.locked_stage_attempts SET provider_request_id=$2
      WHERE id=$1 AND status='RUNNING' AND boundary_state='MAY_HAVE_STARTED' RETURNING *`,
    [attemptId, providerRequestId]);
    if (!result.rows[0]) throw conflict('LOCKED_STAGE_FENCED', 'Locked stage lost ownership while recording provider request identity');
    return result.rows[0];
  }

  async finishLockedStage({ attemptId, status, boundaryState, providerRequestId = null, keyframeId = null,
    result = {}, error = {} }) {
    const finished = await this.db.query(`UPDATE v2_10.locked_stage_attempts SET status=$2,boundary_state=$3,
      provider_request_id=coalesce($4,provider_request_id),keyframe_id=coalesce($5,keyframe_id),
      result=$6,error=$7,completed_at=now() WHERE id=$1 AND status='RUNNING' RETURNING *`,
    [attemptId, status, boundaryState, providerRequestId, keyframeId, result, error]);
    if (!finished.rows[0]) throw conflict('LOCKED_STAGE_FENCED', 'Locked stage attempt is no longer active');
    return finished.rows[0];
  }

  async storeKeyframeArtifact(value) {
    if (!this.storage || !Buffer.isBuffer(value.bytes) || !value.bytes.length) {
      throw conflict('KEYFRAME_STORAGE_REQUIRED', 'Immutable keyframe bytes and storage are required');
    }
    const actualContentHash = crypto.createHash('sha256').update(value.bytes).digest('hex');
    if (value.contentHash !== actualContentHash) throw conflict('KEYFRAME_CONTENT_HASH_MISMATCH',
      'Keyframe bytes do not match the proposed immutable content hash');
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${value.workflowId}:${value.assetId}`]);
      const prior = await client.query(`SELECT id,version FROM v2_10.keyframe_artifacts
        WHERE workflow_id=$1 AND asset_id=$2 ORDER BY version DESC LIMIT 1`, [value.workflowId, value.assetId]);
      const version = Number(prior.rows[0]?.version || 0) + 1;
      const storageKey = `workspaces/${value.workspaceId}/brands/${value.brandId}/productions/${value.productionId}`
        + `/keyframes/${value.assetId}/v${version}-${value.contentHash}`;
      if (!(await this.storage.exists({ key: storageKey }))) {
        await this.storage.put({ key: storageKey, bytes: value.bytes,
          metadata: { contentType: value.contentType, immutable: true, version, productionId: value.productionId } });
      }
      const result = await client.query(`INSERT INTO v2_10.keyframe_artifacts
        (workflow_id,workspace_id,brand_id,production_id,shot_id,asset_id,version,predecessor_id,
         source_type,provider,model,generation_settings,prompt_fingerprint,storage_key,content_hash,
         content_type,size_bytes,width,height,provider_request_id,provenance,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [value.workflowId, value.workspaceId, value.brandId, value.productionId, value.shotId, value.assetId,
        version, prior.rows[0]?.id || null, value.sourceType, value.provider, value.model,
        value.generationSettings || {}, value.promptFingerprint, storageKey, value.contentHash,
        value.contentType, value.bytes.length, value.width, value.height, value.providerRequestId || null,
        value.provenance || {}, value.actor]);
      await client.query(`UPDATE v2_10.locked_keyframe_workflows SET state='KEYFRAME_READY'
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`, [value.workflowId, value.workspaceId, value.brandId]);
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async recordKeyframeValidation({ keyframeId, workspaceId, brandId, shotPlanFingerprint,
    result, semanticExternalCalls, evaluatorProvider, evaluatorModel }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO v2_10.keyframe_validation_events
        (keyframe_id,workspace_id,brand_id,shot_plan_fingerprint,status,result,semantic_external_calls,evaluator_provider,evaluator_model)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(keyframe_id,shot_plan_fingerprint) DO NOTHING RETURNING *`,
      [keyframeId, workspaceId, brandId, shotPlanFingerprint, result.status, result,
        semanticExternalCalls, evaluatorProvider, evaluatorModel]);
      const row = inserted.rows[0] || (await client.query(`SELECT * FROM v2_10.keyframe_validation_events
        WHERE keyframe_id=$1 AND workspace_id=$2 AND brand_id=$3 AND shot_plan_fingerprint=$4`,
      [keyframeId, workspaceId, brandId, shotPlanFingerprint])).rows[0];
      if (row?.status === 'PASS') {
        const advanced = await client.query(`UPDATE v2_10.locked_keyframe_workflows w
          SET state='AWAITING_HUMAN_APPROVAL' FROM v2_10.keyframe_artifacts k
          WHERE k.id=$1 AND w.id=k.workflow_id AND w.workspace_id=$2 AND w.brand_id=$3
            AND w.state='KEYFRAME_READY' RETURNING w.id`, [keyframeId, workspaceId, brandId]);
        if (!advanced.rows[0]) throw conflict('KEYFRAME_VALIDATION_STATE_CONFLICT',
          'Keyframe validation could not advance the exact workflow state');
      }
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async getKeyframe({ id, workspaceId, brandId }) {
    const result = await this.db.query(`SELECT k.*,v.id AS validation_event_id,v.status AS validation_status,v.result AS validation_result,
      a.id AS approval_event_id,a.decision AS approval_decision,a.actor AS approval_actor,a.decided_at AS approved_at
      FROM v2_10.keyframe_artifacts k
      LEFT JOIN LATERAL (SELECT * FROM v2_10.keyframe_validation_events WHERE keyframe_id=k.id ORDER BY created_at DESC LIMIT 1) v ON true
      LEFT JOIN v2_10.keyframe_approval_events a ON a.keyframe_id=k.id
      WHERE k.id=$1 AND k.workspace_id=$2 AND k.brand_id=$3`, [id, workspaceId, brandId]);
    return result.rows[0] || null;
  }

  async approveKeyframe({ keyframeId, workspaceId, brandId, actor, reason = null }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      const keyframe = (await client.query(`SELECT k.*,v.id AS validation_event_id,v.status AS validation_status
        FROM v2_10.keyframe_artifacts k LEFT JOIN LATERAL (
          SELECT * FROM v2_10.keyframe_validation_events WHERE keyframe_id=k.id ORDER BY created_at DESC LIMIT 1
        ) v ON true WHERE k.id=$1 AND k.workspace_id=$2 AND k.brand_id=$3 FOR UPDATE OF k`,
      [keyframeId, workspaceId, brandId])).rows[0];
      if (!keyframe || keyframe.validation_status !== 'PASS') throw conflict('KEYFRAME_VALIDATION_REQUIRED',
        'A current PASS validation is required before keyframe approval');
      const inserted = await client.query(`INSERT INTO v2_10.keyframe_approval_events
        (keyframe_id,validation_event_id,workspace_id,brand_id,decision,actor,reason)
        VALUES($1,$2,$3,$4,'APPROVED',$5,$6) ON CONFLICT(keyframe_id) DO NOTHING RETURNING *`,
      [keyframeId, keyframe.validation_event_id, workspaceId, brandId, actor, reason]);
      const approval = inserted.rows[0] || (await client.query(`SELECT * FROM v2_10.keyframe_approval_events
        WHERE keyframe_id=$1 AND workspace_id=$2 AND brand_id=$3`, [keyframeId, workspaceId, brandId])).rows[0];
      if (approval?.decision !== 'APPROVED') throw conflict('KEYFRAME_APPROVAL_CONFLICT',
        'Keyframe already has a different immutable decision');
      const advanced = await client.query(`UPDATE v2_10.locked_keyframe_workflows w SET state='KEYFRAME_APPROVED'
        FROM v2_10.keyframe_artifacts k WHERE k.id=$1 AND w.id=k.workflow_id
        AND w.workspace_id=$2 AND w.brand_id=$3 AND w.state IN ('AWAITING_HUMAN_APPROVAL','KEYFRAME_APPROVED') RETURNING w.id`,
      [keyframeId, workspaceId, brandId]);
      if (!advanced.rows[0]) throw conflict('KEYFRAME_APPROVAL_STATE_CONFLICT',
        'Keyframe approval could not advance the exact workflow state');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
    return this.getKeyframe({ id: keyframeId, workspaceId, brandId });
  }

  async recordFirstVideoResult({ workflowId, workspaceId, brandId, accepted, result }) {
    const state = accepted ? 'FIRST_VIDEO_ACCEPTED' : 'FIRST_VIDEO_FAILED';
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
      await client.query('COMMIT'); return { ...updated.rows[0], firstVideoResult: result };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { if (client !== this.db) client.release(); }
  }

  async markLockedContinuationStarted({ draftId, workspaceId, brandId, productionId }) {
    try {
      const result = await this.db.query(`UPDATE v2_10.locked_keyframe_workflows SET state='CONTINUATION_STARTED'
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND production_id=$4
          AND state='FIRST_VIDEO_ACCEPTED' RETURNING *`, [draftId, workspaceId, brandId, productionId]);
      return result.rows[0] || null;
    } catch (error) {
      if (['42P01','3F000'].includes(error.code)) return null;
      throw error;
    }
  }
}

module.exports = { V210PostgresRepository };
