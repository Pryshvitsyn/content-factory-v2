'use strict';
const crypto = require('node:crypto');

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
      provider_selection=$6,voice_selection=$7,voice_approval=$8,status=$9 WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 RETURNING *`,
    [id, workspaceId, brandId, brief, validation, providerSelection || {}, voiceSelection || {}, voiceApproval || {}, validation.status === 'FAIL' ? 'CREATIVE_INCOMPLETE' : 'DRAFT']);
    return result.rows[0] || null;
  }
  async savePreflight({ id, workspaceId, brandId, preflight, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE v2_10.creative_drafts SET final_preflight=$4,preflight_fingerprint=$5,status='PREFLIGHT_READY'
        WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status<>'STARTED' RETURNING *`, [id, workspaceId, brandId, preflight, preflight.fingerprint]);
      if (!updated.rows[0]) throw Object.assign(new Error('Creative draft not found'), { code: 'DRAFT_NOT_FOUND' });
      await client.query(`INSERT INTO v2_10.preflight_events(draft_id,workspace_id,brand_id,draft_revision,fingerprint,result,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [id, workspaceId, brandId, updated.rows[0].revision, preflight.fingerprint, preflight, actor]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async findVoicePreview({ workspaceId, brandId, fingerprint }) {
    const result = await this.db.query('SELECT * FROM v2_10.voice_preview_artifacts WHERE workspace_id=$1 AND brand_id=$2 AND preview_fingerprint=$3', [workspaceId, brandId, fingerprint]);
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
  async markStarted({ id, workspaceId, brandId, productionId }) {
    const result = await this.db.query(`UPDATE v2_10.creative_drafts SET status='STARTED',production_id=$4,started_at=now()
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status='STARTING' RETURNING *`,[id,workspaceId,brandId,productionId]);
    if (!result.rows[0]) throw Object.assign(new Error('Draft is not ready to start'),{code:'PREFLIGHT_NOT_READY'});
    return result.rows[0];
  }
  async claimStart({ id, workspaceId, brandId, fingerprint }) {
    const result = await this.db.query(`UPDATE v2_10.creative_drafts SET status='STARTING',start_claimed_at=now()
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 AND status='PREFLIGHT_READY' AND preflight_fingerprint=$4 RETURNING *`,
    [id,workspaceId,brandId,fingerprint]);
    if (!result.rows[0]) throw Object.assign(new Error('Draft start was already claimed or preflight is stale'),{code:'START_CLAIM_REJECTED'});
    return result.rows[0];
  }
}

module.exports = { V210PostgresRepository };
