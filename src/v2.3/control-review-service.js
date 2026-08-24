'use strict';

const DECISIONS = Object.freeze({ approve: 'APPROVED', reject: 'REJECTED' });

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

class ReviewConflictError extends Error {
  constructor(existing) {
    super(`Master already has a terminal ${existing.decision} decision`);
    this.name = 'ReviewConflictError';
    this.code = 'REVIEW_DECISION_CONFLICT';
    this.existing = existing;
  }
}

class ControlReviewService {
  constructor({ db } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    this.db = db;
  }

  async registerMasterForReview({ productionId, brandId, master, script, quality, mediaResults = [] } = {}) {
    requireText('productionId', productionId);
    requireText('brandId', brandId);
    if (!master?.artifact?.artifactId || !master.artifact.storageKey || !master.artifact.contentHash) {
      throw new Error('exact immutable master artifact is required');
    }
    if (quality?.status !== 'PASS' || quality?.readyForHumanReview !== true || quality?.publicationAllowed !== false) {
      throw new Error('master is not eligible for human review');
    }

    const payload = {
      script: script || null,
      hook: script?.hook || null,
      cta: script?.cta || null,
      durationMs: master.probe?.durationMs || null,
      width: master.probe?.width || null,
      height: master.probe?.height || null,
      videoCodec: master.probe?.videoCodec || null,
      audioCodec: master.probe?.audioCodec || null,
      hasAudio: master.probe?.hasAudio === true,
      technicalValidation: quality.checks || [],
    };
    const assets = mediaResults.map((media) => ({
      assetId: media.assetId,
      kind: media.kind,
      provider: media.provider || null,
      model: media.model || null,
      artifactId: media.artifact?.artifactId || null,
      artifactVersion: media.artifact?.version || null,
      contentType: media.contentType || null,
      durationMs: media.mediaProbe?.durationMs || media.temporal?.durationMs || null,
      requestId: media.requestId || media.provenance?.predictionId || null,
    }));

    const result = await this.db.query(
      `/* v2.3:register-master-review */
       INSERT INTO v2_3.master_review_items
         (workspace_id, brand_id, production_id, master_artifact_id, master_artifact_version,
          master_storage_key, master_content_hash, content_type, validation_status,
          review_payload, validation_evidence, provenance, generated_assets)
       SELECT p.workspace_id, p.brand_id, p.id, $3, $4, $5, $6, $7, 'PASS',
              $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb
       FROM v2_1.productions p
       WHERE p.id=$1 AND p.brand_id=$2
       ON CONFLICT (production_id, master_artifact_id, master_storage_key) DO NOTHING
       RETURNING *`,
      [productionId, brandId, master.artifact.artifactId, master.artifact.version,
        master.artifact.storageKey, master.artifact.contentHash, master.contentType || 'video/mp4',
        JSON.stringify(payload), JSON.stringify(quality), JSON.stringify({
          provider: master.artifact.provenance?.provider || null,
          model: master.artifact.provenance?.model || null,
          renderer: master.artifact.provenance?.provider || 'ffmpeg',
        }), JSON.stringify(assets)],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await this.db.query(
      `/* v2.3:get-master-review */ SELECT * FROM v2_3.master_review_items
       WHERE production_id=$1 AND brand_id=$2 AND master_artifact_id=$3 AND master_storage_key=$4`,
      [productionId, brandId, master.artifact.artifactId, master.artifact.storageKey],
    );
    if (!existing.rows[0]) {
      const error = new Error('Production and brand ownership could not be proven');
      error.code = 'BRAND_SCOPE_MISMATCH';
      throw error;
    }
    return existing.rows[0];
  }

  async decide({ reviewItemId, brandId, decision, actor, reason = null } = {}) {
    requireText('reviewItemId', reviewItemId);
    requireText('brandId', brandId);
    requireText('actor', actor);
    const terminalDecision = DECISIONS[decision];
    if (!terminalDecision) throw new Error('decision must be approve or reject');
    if (decision === 'reject') requireText('reason', reason);

    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      const item = await client.query(
        `/* v2.3:lock-review-item */
         SELECT ri.id FROM v2_3.master_review_items ri
         JOIN v2_1.productions p ON p.id=ri.production_id AND p.brand_id=ri.brand_id
         JOIN v2_2.brands b ON b.id=ri.brand_id AND b.workspace_id=ri.workspace_id
         WHERE ri.id=$1 AND ri.brand_id=$2 AND p.workspace_id=ri.workspace_id
         FOR UPDATE OF ri`,
        [reviewItemId, brandId],
      );
      if (!item.rows[0]) {
        const error = new Error('Review item not found in brand scope');
        error.code = 'REVIEW_NOT_FOUND';
        throw error;
      }
      const existing = await client.query(
        `/* v2.3:get-review-decision */ SELECT * FROM v2_3.master_review_decisions WHERE review_item_id=$1`,
        [reviewItemId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].decision !== terminalDecision) throw new ReviewConflictError(existing.rows[0]);
        await client.query('COMMIT');
        return { ...existing.rows[0], idempotent: true };
      }
      const inserted = await client.query(
        `/* v2.3:insert-review-decision */
         INSERT INTO v2_3.master_review_decisions(review_item_id, decision, actor, reason)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [reviewItemId, terminalDecision, actor.trim(), reason?.trim() || null],
      );
      await client.query('COMMIT');
      return { ...inserted.rows[0], idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (client !== this.db) client.release();
    }
  }
}

module.exports = { ControlReviewService, DECISIONS, ReviewConflictError };
