'use strict';

class ControlRepository {
  constructor({ db } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    this.db = db;
  }

  async health() {
    const result = await this.db.query('/* dashboard:health */ SELECT now() AS "databaseTime"');
    return result.rows[0];
  }

  async overview() {
    const summary = await this.db.query(`/* dashboard:overview */
      SELECT
        (SELECT count(*)::int FROM v2_2.brands) AS "totalBrands",
        (SELECT count(*)::int FROM v2_1.productions WHERE status IN ('DRAFT','RUNNING')) AS "activeProductions",
        (SELECT count(*)::int FROM v2_1.jobs WHERE status='QUEUED') AS "queuedJobs",
        (SELECT count(*)::int FROM v2_1.jobs WHERE status='RUNNING') AS "runningJobs",
        (SELECT count(*)::int FROM v2_1.jobs WHERE status IN ('FAILED','DEAD_LETTER')) AS "failedJobs",
        (SELECT count(*)::int FROM v2_3.master_review_items ri
          LEFT JOIN v2_3.master_review_decisions rd ON rd.review_item_id=ri.id
          WHERE ri.validation_status='PASS' AND rd.id IS NULL) AS "awaitingReview",
        (SELECT count(*)::int FROM v2_1.productions
          WHERE status='COMPLETED' AND completed_at >= now() - interval '7 days') AS "recentlyCompleted"`);
    const activity = await this.db.query(`/* dashboard:activity */
      SELECT * FROM (
        SELECT 'PRODUCTION' AS type, p.id, p.name AS label, p.status, p.updated_at AS "occurredAt", p.brand_id AS "brandId"
        FROM v2_1.productions p
        UNION ALL
        SELECT 'JOB', j.id, j.stage, j.status, j.updated_at, p.brand_id
        FROM v2_1.jobs j JOIN v2_1.productions p ON p.id=j.production_id
        UNION ALL
        SELECT 'STAGE', sr.id, sr.stage, sr.status, sr.updated_at, p.brand_id
        FROM v2_1.stage_runs sr
        JOIN v2_1.jobs j ON j.id=sr.job_id
        JOIN v2_1.productions p ON p.id=j.production_id
      ) activity ORDER BY "occurredAt" DESC LIMIT 20`);
    return { ...summary.rows[0], recentActivity: activity.rows };
  }

  async listBrands() {
    const result = await this.db.query(`/* dashboard:list-brands */
      SELECT b.id, b.workspace_id AS "workspaceId", b.name, b.slug, b.status,
             b.mission, b.positioning, b.created_at AS "createdAt", b.updated_at AS "updatedAt",
             count(DISTINCT p.id)::int AS "productCount",
             count(DISTINCT c.id)::int AS "campaignCount"
      FROM v2_2.brands b
      LEFT JOIN v2_2.products p ON p.brand_id=b.id
      LEFT JOIN v2_2.campaigns c ON c.brand_id=b.id
      GROUP BY b.id ORDER BY b.name`);
    return result.rows;
  }

  async getBrand(brandId) {
    const brandResult = await this.db.query(`/* dashboard:get-brand */
      SELECT id, workspace_id AS "workspaceId", name, slug, status, mission, positioning,
             metadata, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM v2_2.brands WHERE id=$1`, [brandId]);
    if (!brandResult.rows[0]) return null;
    const [products, audiences, offers, campaigns, knowledge, assets] = await Promise.all([
      this.db.query(`/* dashboard:brand-products */ SELECT id, name, slug, product_type AS "productType", status,
        value_proposition AS "valueProposition" FROM v2_2.products WHERE brand_id=$1 ORDER BY name`, [brandId]),
      this.db.query(`/* dashboard:brand-audiences */ SELECT a.id, a.name, a.awareness_stage AS "awarenessStage",
        a.problem_statement AS "problemStatement", a.desired_outcome AS "desiredOutcome", a.pains, a.desires,
        a.objections, a.status, a.product_id AS "productId" FROM v2_2.audiences a
        JOIN v2_2.products p ON p.id=a.product_id WHERE p.brand_id=$1 ORDER BY a.name`, [brandId]),
      this.db.query(`/* dashboard:brand-offers */ SELECT o.id, o.name, o.promise, o.cta, o.destination, o.status,
        o.product_id AS "productId" FROM v2_2.offers o JOIN v2_2.products p ON p.id=o.product_id
        WHERE p.brand_id=$1 ORDER BY o.name`, [brandId]),
      this.db.query(`/* dashboard:brand-campaigns */ SELECT id, name, objective, status, starts_at AS "startsAt",
        ends_at AS "endsAt" FROM v2_2.campaigns WHERE brand_id=$1 ORDER BY created_at DESC`, [brandId]),
      this.db.query(`/* dashboard:brand-knowledge */ SELECT DISTINCT ON (bk.id) bk.id,
        bk.knowledge_type AS "knowledgeType", bk.logical_key AS "logicalKey", bk.status,
        bkv.version_no AS "version", bkv.content, bkv.source_type AS "sourceType", bkv.confidence
        FROM v2_2.brand_knowledge bk JOIN v2_2.brand_knowledge_versions bkv ON bkv.knowledge_id=bk.id
        WHERE bk.brand_id=$1 ORDER BY bk.id, bkv.version_no DESC`, [brandId]),
      this.db.query(`/* dashboard:brand-assets */ SELECT ar.id, ar.asset_id AS "assetId", ar.kind,
        ar.artifact_version AS version, ar.status, ar.metadata, ar.created_at AS "createdAt"
        FROM v2_1.asset_registry ar JOIN v2_1.productions p ON p.id=ar.production_id
        WHERE p.brand_id=$1 ORDER BY ar.created_at DESC`, [brandId]),
    ]);
    return { ...brandResult.rows[0], products: products.rows, audiences: audiences.rows, offers: offers.rows,
      campaigns: campaigns.rows, knowledge: knowledge.rows, assets: assets.rows };
  }

  async listProductions({ brandId = null, status = null } = {}) {
    const result = await this.db.query(`/* dashboard:list-productions */
      SELECT p.id, p.workspace_id AS "workspaceId", p.brand_id AS "brandId", b.name AS "brandName",
        p.name, p.objective, p.status, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        COALESCE(p.metadata->>'render_mode','QUALITY') AS "renderMode",
        COALESCE(p.metadata->>'renderer','v2.5-quality') AS renderer,
        current_stage.stage AS "currentStage", current_stage.status AS "currentStageStatus",
        COALESCE(decision.decision,
          CASE WHEN review.id IS NOT NULL THEN 'AWAITING_HUMAN_APPROVAL' ELSE NULL END) AS "reviewState"
      FROM v2_1.productions p
      LEFT JOIN v2_2.brands b ON b.id=p.brand_id AND b.workspace_id=p.workspace_id
      LEFT JOIN LATERAL (
        SELECT sr.stage, sr.status FROM v2_1.stage_runs sr JOIN v2_1.jobs j ON j.id=sr.job_id
        WHERE j.production_id=p.id ORDER BY sr.updated_at DESC LIMIT 1
      ) current_stage ON true
      LEFT JOIN LATERAL (
        SELECT ri.id FROM v2_3.master_review_items ri WHERE ri.production_id=p.id ORDER BY ri.created_at DESC LIMIT 1
      ) review ON true
      LEFT JOIN v2_3.master_review_decisions decision ON decision.review_item_id=review.id
      WHERE ($1::uuid IS NULL OR p.brand_id=$1) AND ($2::text IS NULL OR p.status=$2)
      ORDER BY p.created_at DESC`, [brandId, status]);
    return result.rows;
  }

  async getProduction(productionId, brandId = null) {
    const result = await this.db.query(`/* dashboard:get-production */
      SELECT p.*, p.workspace_id AS "workspaceId", p.brand_id AS "brandId", p.product_id AS "productId",
        p.campaign_id AS "campaignId", p.content_item_id AS "contentItemId", b.name AS "brandName",
        COALESCE(p.metadata->>'render_mode','QUALITY') AS "renderMode",
        COALESCE(p.metadata->>'renderer','v2.5-quality') AS renderer
      FROM v2_1.productions p
      LEFT JOIN v2_2.brands b ON b.id=p.brand_id AND b.workspace_id=p.workspace_id
      WHERE p.id=$1 AND ($2::uuid IS NULL OR p.brand_id=$2)`, [productionId, brandId]);
    return result.rows[0] || null;
  }

  async listStages(productionId, brandId = null) {
    const result = await this.db.query(`/* dashboard:list-stages */
      SELECT sd.stage, sd.sequence_no AS "sequence", latest.status, latest.attempt,
        latest.started_at AS "startedAt", latest.completed_at AS "completedAt", latest.error,
        latest.metadata->>'provider' AS provider, latest.metadata->>'model' AS model,
        latest.input_artifacts AS "inputArtifacts", latest.output_artifacts AS "outputArtifacts"
      FROM v2_1.stage_definitions sd
      LEFT JOIN LATERAL (
        SELECT sr.* FROM v2_1.stage_runs sr
        JOIN v2_1.jobs j ON j.id=sr.job_id
        JOIN v2_1.productions p ON p.id=j.production_id
        WHERE p.id=$1 AND ($2::uuid IS NULL OR p.brand_id=$2) AND sr.stage=sd.stage
        ORDER BY sr.attempt DESC, sr.updated_at DESC LIMIT 1
      ) latest ON true ORDER BY sd.sequence_no`, [productionId, brandId]);
    return result.rows;
  }

  async listArtifacts(productionId, brandId = null) {
    const result = await this.db.query(`/* dashboard:list-artifacts */
      SELECT ri.id AS "sourceId", 'MASTER' AS type, ri.master_artifact_id AS "artifactId",
        ri.master_artifact_version AS version, ri.content_type AS "contentType",
        ri.validation_status AS "validationStatus", ri.provenance,
        ri.created_at AS "createdAt", ri.brand_id AS "brandId",
        CASE WHEN rd.id IS NULL THEN 'AWAITING_HUMAN_APPROVAL' ELSE rd.decision END AS "reviewState"
      FROM v2_3.master_review_items ri
      JOIN v2_1.productions p ON p.id=ri.production_id AND p.brand_id=ri.brand_id AND p.workspace_id=ri.workspace_id
      LEFT JOIN v2_3.master_review_decisions rd ON rd.review_item_id=ri.id
      WHERE ri.production_id=$1 AND ($2::uuid IS NULL OR ri.brand_id=$2)
      UNION ALL
      SELECT ar.id, upper(ar.kind), ar.asset_id, ar.artifact_version,
        CASE ar.kind WHEN 'image' THEN 'image/png' WHEN 'video' THEN 'video/mp4'
          WHEN 'voice' THEN 'audio/mpeg' WHEN 'audio' THEN 'audio/mpeg' ELSE 'application/octet-stream' END,
        ar.status, ar.metadata, ar.created_at, p.brand_id, NULL
      FROM v2_1.asset_registry ar JOIN v2_1.productions p ON p.id=ar.production_id
      WHERE ar.production_id=$1 AND ($2::uuid IS NULL OR p.brand_id=$2)
      ORDER BY "createdAt" DESC`, [productionId, brandId]);
    return result.rows;
  }

  async listReviews({ brandId = null, includeDecided = false } = {}) {
    const result = await this.db.query(`/* dashboard:list-reviews */
      SELECT ri.id, ri.workspace_id AS "workspaceId", ri.brand_id AS "brandId", b.name AS "brandName",
        ri.production_id AS "productionId", p.name AS "productionName", ri.master_artifact_id AS "artifactId",
        ri.master_artifact_version AS "artifactVersion", ri.content_type AS "contentType",
        ri.validation_status AS "validationStatus", ri.review_payload AS "reviewPayload",
        ri.validation_evidence AS "validationEvidence", ri.provenance, ri.generated_assets AS "generatedAssets",
        ri.created_at AS "createdAt", p.status AS "productionStatus",
        COALESCE(ri.review_payload->>'renderMode',p.metadata->>'render_mode','QUALITY') AS "renderMode",
        COALESCE(ri.review_payload->>'renderer',ri.provenance->>'renderer',p.metadata->>'renderer','v2.5-quality') AS renderer,
        COALESCE(ri.review_payload->>'rendererStatus',ri.provenance->>'rendererStatus','SUCCEEDED') AS "rendererStatus",
        CASE WHEN rd.id IS NULL THEN 'AWAITING_HUMAN_APPROVAL' ELSE rd.decision END AS "reviewStatus",
        CASE WHEN coalesce((p.metadata->'publication_policy'->>'autoPublish')::boolean,false)=false
          THEN 'DISABLED_PENDING_APPROVAL' ELSE 'NOT_TRIGGERED' END AS "publicationStatus",
        p.metadata->'publication_policy' AS "publicationPolicy",
        rd.decision, rd.actor, rd.reason, rd.decided_at AS "decidedAt"
      FROM v2_3.master_review_items ri
      JOIN v2_1.productions p ON p.id=ri.production_id AND p.brand_id=ri.brand_id AND p.workspace_id=ri.workspace_id
      JOIN v2_2.brands b ON b.id=ri.brand_id AND b.workspace_id=ri.workspace_id
      LEFT JOIN v2_3.master_review_decisions rd ON rd.review_item_id=ri.id
      WHERE ri.validation_status='PASS' AND ($1::uuid IS NULL OR ri.brand_id=$1)
        AND ($2::boolean OR rd.id IS NULL)
      ORDER BY ri.created_at DESC`, [brandId, includeDecided]);
    return result.rows;
  }

  async resolveArtifact({ sourceId, artifactId, version, brandId }) {
    const master = await this.db.query(`/* dashboard:resolve-master-content */
      SELECT ri.master_storage_key AS "storageKey", ri.content_type AS "contentType"
      FROM v2_3.master_review_items ri
      JOIN v2_1.productions p ON p.id=ri.production_id AND p.brand_id=ri.brand_id AND p.workspace_id=ri.workspace_id
      JOIN v2_2.brands b ON b.id=ri.brand_id AND b.workspace_id=ri.workspace_id
      WHERE ri.id=$1 AND ri.master_artifact_id=$2 AND ri.master_artifact_version=$3 AND ri.brand_id=$4`,
    [sourceId, artifactId, version, brandId]);
    if (master.rows[0]) return master.rows[0];
    const asset = await this.db.query(`/* dashboard:resolve-asset-content */
      SELECT ar.artifact_storage_key AS "storageKey",
        CASE ar.kind WHEN 'image' THEN 'image/png' WHEN 'video' THEN 'video/mp4'
          WHEN 'voice' THEN 'audio/mpeg' WHEN 'audio' THEN 'audio/mpeg' ELSE 'application/octet-stream' END AS "contentType"
      FROM v2_1.asset_registry ar JOIN v2_1.productions p ON p.id=ar.production_id
      JOIN v2_2.brands b ON b.id=p.brand_id AND b.workspace_id=p.workspace_id
      WHERE ar.id=$1 AND ar.asset_id=$2 AND ar.artifact_version=$3 AND p.brand_id=$4`,
    [sourceId, artifactId, version, brandId]);
    return asset.rows[0] || null;
  }
}

module.exports = { ControlRepository };
