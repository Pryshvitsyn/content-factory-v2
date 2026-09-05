"use strict";

const { ArtifactService } = require("../artifacts/artifact-service");
const {
  referencePackRevision,
  ContinuityError,
} = require("./continuity-entities");

class AvatarStudioContinuityAuthorityResolver {
  constructor({ repository } = {}) {
    if (!repository?.getCharacter)
      throw new Error("Avatar Studio repository is required");
    this.repository = repository;
  }
  async verify({ workspaceId, brandId, ownerBrandId, authorityBinding }) {
    const avatar = await this.repository.getCharacter({
      id: authorityBinding.avatarId,
      brandId: ownerBrandId,
    });
    if (!avatar || avatar.workspaceId !== workspaceId)
      return Object.freeze({
        identityCurrent: false,
        identityLockCurrent: false,
        consentValid: false,
      });
    const consent = avatar.consent;
    const allowedBrands =
      consent?.allowedBrandIds || consent?.allowed_brand_ids || [];
    const allowedVerticals =
      consent?.allowedVerticals || consent?.allowed_verticals || [];
    const vertical = authorityBinding.vertical || avatar.vertical;
    const allowedUseTypes =
      consent?.allowedUseTypes || consent?.allowed_use_types || [];
    const requiredUseType = authorityBinding.useType || null;
    const notExpired =
      !consent?.expiresAt || new Date(consent.expiresAt) > new Date();
    return Object.freeze({
      identityCurrent:
        avatar.identityVersionId === authorityBinding.identityVersionId,
      identityLockCurrent:
        avatar.identityLocks?.[0]?.id === authorityBinding.identityLockId,
      consentValid: Boolean(
        consent &&
        consent.modality === "FACE" &&
        consent.status === "APPROVED" &&
        notExpired &&
        allowedBrands.includes(brandId) &&
        allowedVerticals.includes(vertical) &&
        (!requiredUseType || allowedUseTypes.includes(requiredUseType)),
      ),
    });
  }
}

class ContinuityAuthorityRepository {
  constructor({ db, storage, avatarAuthorityResolver = null } = {}) {
    if (!db || !storage) throw new Error("db and storage are required");
    this.db = db;
    this.storage = storage;
    this.artifacts = new ArtifactService({ storage });
    this.avatarAuthorityResolver = avatarAuthorityResolver;
  }
  async savePack(raw, actor) {
    const pack = referencePackRevision(raw);
    const artifact = await this.artifacts.createVersion({
      artifactId: `continuity-pack:${pack.workspaceId}:${pack.ownerBrandId}:${pack.entityId}:r${pack.revision}`,
      type: "text",
      content: JSON.stringify(pack),
      idempotencyKey: `continuity-pack:${pack.revisionFingerprint}`,
      provider: "content-factory",
      model: "continuity-reference-pack@1",
      validationStatus: "immutable_continuity_authority",
    });
    const result = await this.db.query(
      `INSERT INTO workflow_authority.continuity_reference_pack_revisions
      (workspace_id,owner_brand_id,entity_id,entity_type,revision,fingerprint,artifact_id,artifact_version,artifact_content_hash,artifact_storage_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(workspace_id,owner_brand_id,entity_id,revision) DO NOTHING RETURNING *`,
      [
        pack.workspaceId,
        pack.ownerBrandId,
        pack.entityId,
        pack.entityType,
        pack.revision,
        pack.revisionFingerprint,
        artifact.artifactId,
        artifact.version,
        artifact.contentHash,
        artifact.storageKey,
        actor,
      ],
    );
    const row =
      result.rows[0] ||
      (
        await this.db.query(
          `SELECT * FROM workflow_authority.continuity_reference_pack_revisions
      WHERE workspace_id=$1 AND owner_brand_id=$2 AND entity_id=$3 AND revision=$4`,
          [pack.workspaceId, pack.ownerBrandId, pack.entityId, pack.revision],
        )
      ).rows[0];
    if (!row || row.fingerprint !== pack.revisionFingerprint)
      throw new ContinuityError(
        "CONTINUITY_REVISION_CONFLICT",
        "Continuity revision already exists with different immutable content",
      );
    return Object.freeze({ row, pack });
  }
  async grant({
    workspaceId,
    ownerBrandId,
    consumerBrandId,
    packId,
    packFingerprint,
    decision,
    actor,
    reason,
  }) {
    const result = await this.db.query(
      `INSERT INTO workflow_authority.continuity_reference_grant_events
      (workspace_id,owner_brand_id,consumer_brand_id,pack_id,pack_fingerprint,decision,actor,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        workspaceId,
        ownerBrandId,
        consumerBrandId,
        packId,
        packFingerprint,
        decision,
        actor,
        reason,
      ],
    );
    return result.rows[0];
  }
  async load({ workspaceId, consumerBrandId, packId, fingerprint }) {
    const row = (
      await this.db.query(
        `SELECT * FROM workflow_authority.continuity_reference_pack_revisions
      WHERE id=$1 AND workspace_id=$2 AND fingerprint=$3`,
        [packId, workspaceId, fingerprint],
      )
    ).rows[0];
    if (!row)
      throw new ContinuityError(
        "CONTINUITY_REVISION_NOT_FOUND",
        "Exact durable continuity revision was not found",
      );
    if (row.owner_brand_id !== consumerBrandId) {
      const event = (
        await this.db.query(
          `SELECT * FROM workflow_authority.continuity_reference_grant_events
        WHERE workspace_id=$1 AND owner_brand_id=$2 AND consumer_brand_id=$3 AND pack_id=$4 AND pack_fingerprint=$5
        ORDER BY created_at DESC,id DESC LIMIT 1`,
          [
            workspaceId,
            row.owner_brand_id,
            consumerBrandId,
            row.id,
            row.fingerprint,
          ],
        )
      ).rows[0];
      if (!event || event.decision !== "GRANTED")
        throw new ContinuityError(
          "CONTINUITY_BRAND_ACCESS_DENIED",
          "No effective durable grant exists for this exact pack revision",
        );
    }
    const bytes = await this.storage.get({ key: row.artifact_storage_key });
    const crypto = require("node:crypto");
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !==
      row.artifact_content_hash
    )
      throw new ContinuityError(
        "CONTINUITY_ARTIFACT_HASH_MISMATCH",
        "Durable continuity artifact hash mismatch",
      );
    const pack = referencePackRevision(JSON.parse(bytes.toString("utf8")));
    if (pack.revisionFingerprint !== row.fingerprint)
      throw new ContinuityError(
        "CONTINUITY_REVISION_FINGERPRINT_MISMATCH",
        "Durable continuity fingerprint mismatch",
      );
    if (pack.approval?.approved !== true)
      throw new ContinuityError(
        "CONTINUITY_REVISION_APPROVAL_REQUIRED",
        "Durable continuity revision is not approved",
      );
    if (pack.entityType === "REAL_PERSON") {
      if (!this.avatarAuthorityResolver?.verify)
        throw new ContinuityError(
          "AVATAR_AUTHORITY_RESOLVER_REQUIRED",
          "REAL_PERSON requires current read-only Avatar Studio authority",
        );
      const verified = await this.avatarAuthorityResolver.verify({
        workspaceId,
        brandId: consumerBrandId,
        ownerBrandId: row.owner_brand_id,
        authorityBinding: pack.authorityBinding,
      });
      if (
        !verified?.identityCurrent ||
        !verified?.identityLockCurrent ||
        !verified?.consentValid
      )
        throw new ContinuityError(
          "AVATAR_AUTHORITY_INVALID",
          "Avatar identity/lock/consent authority is not current for this use scope",
        );
    }
    return Object.freeze({ row, pack });
  }
  async resolve({ workspaceId, consumerBrandId, packId, fingerprint }) {
    const loaded = await this.load({
      workspaceId,
      consumerBrandId,
      packId,
      fingerprint,
    });
    const crypto = require("node:crypto");
    const references = [];
    for (const reference of loaded.pack.references) {
      if (!reference.storageKey)
        throw new ContinuityError(
          "CONTINUITY_REFERENCE_STORAGE_REQUIRED",
          "Durable continuity reference has no immutable storage locator",
        );
      const bytes = await this.storage.get({ key: reference.storageKey });
      if (
        !Buffer.isBuffer(bytes) ||
        crypto.createHash("sha256").update(bytes).digest("hex") !==
          reference.sha256
      )
        throw new ContinuityError(
          "CONTINUITY_REFERENCE_HASH_MISMATCH",
          "Durable continuity reference bytes do not match approved SHA",
        );
      references.push(Object.freeze({ ...reference, byteSize: bytes.length }));
    }
    return Object.freeze({ ...loaded, references: Object.freeze(references) });
  }
  async listAccessible({ workspaceId, consumerBrandId }) {
    if (!workspaceId || !consumerBrandId)
      throw new ContinuityError(
        "CONTINUITY_SCOPE_REQUIRED",
        "Explicit workspace and brand are required",
      );
    const rows = (
      await this.db.query(
        `SELECT p.*,
      CASE WHEN p.owner_brand_id=$2 THEN 'BRAND_PRIVATE' ELSE effective.decision END AS access_status
      FROM workflow_authority.continuity_reference_pack_revisions p
      LEFT JOIN LATERAL (
        SELECT e.decision
        FROM workflow_authority.continuity_reference_grant_events e
        WHERE e.workspace_id=p.workspace_id AND e.owner_brand_id=p.owner_brand_id
          AND e.consumer_brand_id=$2 AND e.pack_id=p.id AND e.pack_fingerprint=p.fingerprint
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1
      ) effective ON true
      WHERE p.workspace_id=$1
        AND (p.owner_brand_id=$2 OR effective.decision='GRANTED')
      ORDER BY p.entity_id,p.revision DESC,p.created_at DESC`,
        [workspaceId, consumerBrandId],
      )
    ).rows;
    const output = [];
    for (const row of rows) {
      const bytes = await this.storage.get({ key: row.artifact_storage_key });
      if (!Buffer.isBuffer(bytes))
        throw new ContinuityError(
          "CONTINUITY_ARTIFACT_MISSING",
          "Durable continuity artifact is unavailable",
        );
      const pack = referencePackRevision(JSON.parse(bytes.toString("utf8")));
      let authorityStatus =
        pack.approval?.approved === true ? "READY" : "BLOCKED";
      if (authorityStatus === "READY" && pack.entityType === "REAL_PERSON") {
        const verified = this.avatarAuthorityResolver?.verify
          ? await this.avatarAuthorityResolver.verify({
              workspaceId,
              brandId: consumerBrandId,
              ownerBrandId: row.owner_brand_id,
              authorityBinding: pack.authorityBinding,
            })
          : null;
        if (
          !verified?.identityCurrent ||
          !verified?.identityLockCurrent ||
          !verified?.consentValid
        )
          authorityStatus = "BLOCKED";
      }
      output.push(
        Object.freeze({
          packId: row.id,
          packFingerprint: row.fingerprint,
          entityId: row.entity_id,
          displayName: pack.displayName,
          entityType: row.entity_type,
          revision: Number(row.revision),
          ownerBrandId: row.owner_brand_id,
          referenceCount: pack.references.length,
          visibility: pack.visibility,
          authorityStatus,
        }),
      );
    }
    return Object.freeze(output);
  }
}
module.exports = {
  AvatarStudioContinuityAuthorityResolver,
  ContinuityAuthorityRepository,
};
