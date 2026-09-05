'use strict';

const { ArtifactService } = require('../artifacts/artifact-service');
const { referencePackRevision, ContinuityError } = require('./continuity-entities');

class ContinuityAuthorityRepository {
  constructor({ db, storage, avatarAuthorityResolver = null } = {}) {
    if (!db || !storage) throw new Error('db and storage are required');
    this.db = db; this.storage = storage; this.artifacts = new ArtifactService({ storage });
    this.avatarAuthorityResolver = avatarAuthorityResolver;
  }
  async savePack(raw, actor) {
    const pack = referencePackRevision(raw);
    const artifact = await this.artifacts.createVersion({ artifactId: `continuity-pack:${pack.workspaceId}:${pack.ownerBrandId}:${pack.entityId}:r${pack.revision}`,
      type: 'text', content: JSON.stringify(pack), idempotencyKey: `continuity-pack:${pack.revisionFingerprint}`,
      provider: 'content-factory', model: 'continuity-reference-pack@1', validationStatus: 'immutable_continuity_authority' });
    const result = await this.db.query(`INSERT INTO workflow_authority.continuity_reference_pack_revisions
      (workspace_id,owner_brand_id,entity_id,entity_type,revision,fingerprint,artifact_id,artifact_version,artifact_content_hash,artifact_storage_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(workspace_id,owner_brand_id,entity_id,revision) DO NOTHING RETURNING *`,
    [pack.workspaceId,pack.ownerBrandId,pack.entityId,pack.entityType,pack.revision,pack.revisionFingerprint,
      artifact.artifactId,artifact.version,artifact.contentHash,artifact.storageKey,actor]);
    const row = result.rows[0] || (await this.db.query(`SELECT * FROM workflow_authority.continuity_reference_pack_revisions
      WHERE workspace_id=$1 AND owner_brand_id=$2 AND entity_id=$3 AND revision=$4`,
    [pack.workspaceId,pack.ownerBrandId,pack.entityId,pack.revision])).rows[0];
    if (!row || row.fingerprint !== pack.revisionFingerprint) throw new ContinuityError('CONTINUITY_REVISION_CONFLICT','Continuity revision already exists with different immutable content');
    return Object.freeze({ row, pack });
  }
  async grant({ workspaceId, ownerBrandId, consumerBrandId, packId, packFingerprint, decision, actor, reason }) {
    const result = await this.db.query(`INSERT INTO workflow_authority.continuity_reference_grant_events
      (workspace_id,owner_brand_id,consumer_brand_id,pack_id,pack_fingerprint,decision,actor,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [workspaceId,ownerBrandId,consumerBrandId,packId,packFingerprint,decision,actor,reason]); return result.rows[0];
  }
  async load({ workspaceId, consumerBrandId, packId, fingerprint }) {
    const row = (await this.db.query(`SELECT * FROM workflow_authority.continuity_reference_pack_revisions
      WHERE id=$1 AND workspace_id=$2 AND fingerprint=$3`,[packId,workspaceId,fingerprint])).rows[0];
    if (!row) throw new ContinuityError('CONTINUITY_REVISION_NOT_FOUND','Exact durable continuity revision was not found');
    if (row.owner_brand_id !== consumerBrandId) {
      const event = (await this.db.query(`SELECT * FROM workflow_authority.continuity_reference_grant_events
        WHERE workspace_id=$1 AND owner_brand_id=$2 AND consumer_brand_id=$3 AND pack_id=$4 AND pack_fingerprint=$5
        ORDER BY created_at DESC,id DESC LIMIT 1`,[workspaceId,row.owner_brand_id,consumerBrandId,row.id,row.fingerprint])).rows[0];
      if (!event || event.decision !== 'GRANTED') throw new ContinuityError('CONTINUITY_BRAND_ACCESS_DENIED','No effective durable grant exists for this exact pack revision');
    }
    const bytes = await this.storage.get({ key: row.artifact_storage_key });
    const crypto = require('node:crypto');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.artifact_content_hash) throw new ContinuityError('CONTINUITY_ARTIFACT_HASH_MISMATCH','Durable continuity artifact hash mismatch');
    const pack = referencePackRevision(JSON.parse(bytes.toString('utf8')));
    if (pack.revisionFingerprint !== row.fingerprint) throw new ContinuityError('CONTINUITY_REVISION_FINGERPRINT_MISMATCH','Durable continuity fingerprint mismatch');
    if (pack.entityType === 'REAL_PERSON') {
      if (!this.avatarAuthorityResolver?.verify) throw new ContinuityError('AVATAR_AUTHORITY_RESOLVER_REQUIRED','REAL_PERSON requires current read-only Avatar Studio authority');
      const verified = await this.avatarAuthorityResolver.verify({ workspaceId, brandId: consumerBrandId, authorityBinding: pack.authorityBinding });
      if (!verified?.identityCurrent || !verified?.identityLockCurrent || !verified?.consentValid) throw new ContinuityError('AVATAR_AUTHORITY_INVALID','Avatar identity/lock/consent authority is not current for this use scope');
    }
    return Object.freeze({ row, pack });
  }
}
module.exports = { ContinuityAuthorityRepository };
