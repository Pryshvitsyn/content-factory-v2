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
}

module.exports = { V210PostgresRepository };
