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
        (SELECT count(*)::int FROM v2_1.jobs WHERE status IN ('FAILED','DEAD_LETTER','RETRYING')) AS "failedJobs",
        (SELECT count(*)::int FROM v2_3.master_review_items ri
          LEFT JOIN v2_3.master_review_decisions rd ON rd.review_item_id=ri.id
          WHERE ri.validation_status='PASS' AND rd.id IS NULL) AS "awaitingReview",
        (SELECT count(*)::int FROM v2_1.productions
          WHERE status='COMPLETED' AND completed_at >= date_trunc('day',now())) AS "completedToday",
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

  async listProductions({ brandId = null, status = null, renderMode = null, needsReview = false, failed = false } = {}) {
    const result = await this.db.query(`/* dashboard:list-productions */
      SELECT p.id, p.workspace_id AS "workspaceId", p.brand_id AS "brandId", b.name AS "brandName",
        p.name, COALESCE(p.metadata->'canonical_request'->>'title',p.name) AS title,
        p.objective, p.status, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        COALESCE(p.metadata->>'render_mode','QUALITY') AS "renderMode",
        COALESCE(p.metadata->>'renderer','v2.5-quality') AS renderer,
        (p.metadata->'canonical_request'->>'targetDurationSeconds')::numeric AS "targetDurationSeconds",
        latest_job.id AS "jobId", latest_job.status AS "jobStatus", latest_job.error AS error,
        COALESCE(review.quality_status,review.validation_status,latest_job.error->'validation'->>'status',
          latest_job.error->'details'->'quality'->>'status') AS "validationStatus",
        current_stage.stage AS "currentStage", current_stage.status AS "currentStageStatus",
        CASE WHEN p.metadata ? 'publication_policy'
          AND coalesce((p.metadata->'publication_policy'->>'autoPublish')::boolean,false)=false THEN 'DISABLED'
          WHEN p.metadata ? 'publication_policy' THEN 'NOT_TRIGGERED' ELSE 'NOT_CONFIGURED' END AS "publicationStatus",
        COALESCE(decision.decision,
          CASE WHEN review.id IS NOT NULL THEN 'AWAITING_HUMAN_APPROVAL'
            WHEN COALESCE(latest_job.error->'validation'->>'status',latest_job.error->'details'->'quality'->>'status')='FAIL'
              THEN 'BLOCKED' ELSE NULL END) AS "reviewState"
      FROM v2_1.productions p
      LEFT JOIN v2_2.brands b ON b.id=p.brand_id AND b.workspace_id=p.workspace_id
      LEFT JOIN LATERAL (
        SELECT j.id,j.status,j.error FROM v2_1.jobs j WHERE j.production_id=p.id ORDER BY j.created_at DESC LIMIT 1
      ) latest_job ON true
      LEFT JOIN LATERAL (
        SELECT sr.stage, sr.status FROM v2_1.stage_runs sr JOIN v2_1.jobs j ON j.id=sr.job_id
        WHERE j.production_id=p.id ORDER BY sr.updated_at DESC LIMIT 1
      ) current_stage ON true
      LEFT JOIN LATERAL (
        SELECT ri.id,ri.validation_status,ri.validation_evidence->>'status' AS quality_status
        FROM v2_3.master_review_items ri WHERE ri.production_id=p.id ORDER BY ri.created_at DESC LIMIT 1
      ) review ON true
      LEFT JOIN v2_3.master_review_decisions decision ON decision.review_item_id=review.id
      WHERE ($1::uuid IS NULL OR p.brand_id=$1) AND ($2::text IS NULL OR p.status=$2)
        AND ($3::text IS NULL OR COALESCE(p.metadata->>'render_mode','QUALITY')=$3)
        AND (NOT $4::boolean OR (review.id IS NOT NULL AND decision.id IS NULL))
        AND (NOT $5::boolean OR p.status='FAILED' OR latest_job.status IN ('FAILED','DEAD_LETTER','RETRYING'))
      ORDER BY p.created_at DESC`, [brandId, status, renderMode, needsReview, failed]);
    return result.rows;
  }

  async getProduction(productionId, brandId = null) {
    const result = await this.db.query(`/* dashboard:get-production */
      SELECT p.*, p.workspace_id AS "workspaceId", p.brand_id AS "brandId", p.product_id AS "productId",
        p.campaign_id AS "campaignId", p.content_item_id AS "contentItemId", b.name AS "brandName",
        COALESCE(p.metadata->>'render_mode','QUALITY') AS "renderMode",
        COALESCE(p.metadata->>'renderer','v2.5-quality') AS renderer,
        COALESCE(p.metadata->'canonical_request'->>'title',p.name) AS title,
        p.metadata->'canonical_request' AS "canonicalRequest",
        p.metadata->>'regeneration_of' AS "regenerationOf",
        latest_job.id AS "jobId", latest_job.status AS "jobStatus", latest_job.payload AS "jobPayload",
        latest_job.result AS "jobResult", latest_job.error AS "jobError",
        CASE WHEN decision.id IS NOT NULL THEN decision.decision
          WHEN review.id IS NOT NULL THEN 'AWAITING_HUMAN_APPROVAL'
          WHEN COALESCE(latest_job.error->'validation'->>'status',latest_job.error->'details'->'quality'->>'status')='FAIL'
            THEN 'BLOCKED' ELSE NULL END AS "reviewState",
        COALESCE(review.quality_status,review.validation_status,latest_job.error->'validation'->>'status',
          latest_job.error->'details'->'quality'->>'status') AS "validationStatus",
        COALESCE(review.validation_evidence->'lifecycle',latest_job.error->'details'->'quality'->'lifecycle',
          latest_job.error->'validation'->'lifecycle') AS "qualityLifecycle",
        COALESCE(review.validation_evidence,latest_job.error->'validation',
          CASE WHEN latest_job.error->'details'->'quality' IS NOT NULL THEN
            latest_job.error->'details'->'quality' || jsonb_build_object(
              'validationClass','POST_RENDER','timestamp',latest_job.updated_at,
              'masterArtifact',latest_job.error->'details'->'masterArtifact')
          ELSE NULL END) AS "validationEvidence",
        review.review_payload AS "reviewPayload"
      FROM v2_1.productions p
      LEFT JOIN v2_2.brands b ON b.id=p.brand_id AND b.workspace_id=p.workspace_id
      LEFT JOIN LATERAL (
        SELECT j.* FROM v2_1.jobs j WHERE j.production_id=p.id ORDER BY j.created_at DESC LIMIT 1
      ) latest_job ON true
      LEFT JOIN LATERAL (
        SELECT ri.id,ri.validation_status,ri.validation_evidence,ri.validation_evidence->>'status' AS quality_status,ri.review_payload FROM v2_3.master_review_items ri
        WHERE ri.production_id=p.id ORDER BY ri.created_at DESC LIMIT 1
      ) review ON true
      LEFT JOIN v2_3.master_review_decisions decision ON decision.review_item_id=review.id
      WHERE p.id=$1 AND ($2::uuid IS NULL OR p.brand_id=$2)`, [productionId, brandId]);
    return result.rows[0] || null;
  }

  async getCommandProduction(productionId, brandId) {
    return this.getProduction(productionId, brandId);
  }

  async executionSafety(productionId) {
    const tables = await this.db.query(`/* dashboard:execution-safety-schema */ SELECT
      to_regclass('v2_5.media_executions') IS NOT NULL AS media,
      to_regclass('v2_6.fast_render_executions') IS NOT NULL AS fast`);
    let ambiguousExecutions = 0;
    let actualProviderCalls = 0;
    if (tables.rows[0]?.media) {
      const media = await this.db.query(`/* dashboard:media-execution-safety */ SELECT
        count(*) FILTER (WHERE status IN ('MAY_HAVE_STARTED','NEEDS_RECONCILIATION'))::int AS ambiguous,
        count(provider_request_id)::int AS calls
        FROM v2_5.media_executions WHERE production_id=$1`, [productionId]);
      ambiguousExecutions += media.rows[0]?.ambiguous || 0;
      actualProviderCalls += media.rows[0]?.calls || 0;
    }
    if (tables.rows[0]?.fast) {
      const fast = await this.db.query(`/* dashboard:fast-execution-safety */ SELECT
        count(*) FILTER (WHERE status IN ('MAY_HAVE_STARTED','REQUEST_ACCEPTED','PROCESSING','NEEDS_RECONCILIATION'))::int AS ambiguous,
        count(renderer_task_id)::int AS calls
        FROM v2_6.fast_render_executions WHERE production_id=$1`, [productionId]);
      ambiguousExecutions += fast.rows[0]?.ambiguous || 0;
      actualProviderCalls += fast.rows[0]?.calls || 0;
    }
    return { ambiguousExecutions, actualProviderCalls };
  }

  async semanticRetryMediaExecutions(productionId, brandId) {
    const available = await this.db.query("SELECT to_regclass('v2_5.media_executions') IS NOT NULL AS ready");
    if (!available.rows[0]?.ready) return [];
    const result = await this.db.query(`/* dashboard:semantic-retry-media-state */
      SELECT me.asset_id,me.kind,me.status,me.artifact_id,me.artifact_version,
        me.artifact_storage_key,me.artifact_content_hash
      FROM v2_5.media_executions me JOIN v2_1.productions p ON p.id=me.production_id
      WHERE me.production_id=$1 AND me.brand_id=$2 AND p.brand_id=$2 AND p.workspace_id=me.workspace_id`,
    [productionId, brandId]);
    return result.rows;
  }

  async latestSemanticRetryAttempt(productionId, brandId, assetId) {
    const available = await this.db.query("SELECT to_regclass('v2_9.semantic_evaluation_attempts') IS NOT NULL AS ready");
    if (!available.rows[0]?.ready) return null;
    const result = await this.db.query(`/* dashboard:latest-semantic-retry-attempt */
      SELECT sea.* FROM v2_9.semantic_evaluation_attempts sea
      JOIN v2_1.productions p ON p.id=sea.production_id
      WHERE sea.production_id=$1 AND sea.brand_id=$2 AND sea.asset_id=$3
        AND p.brand_id=$2 AND p.workspace_id=sea.workspace_id
      ORDER BY sea.attempt DESC LIMIT 1`, [productionId, brandId, assetId]);
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
        (p.metadata->>'source'='v2.7-operator-console') AS "commandAvailable",
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

  async listShotRegenerations(productionId, brandId) {
    const exists = await this.db.query("SELECT to_regclass('v2_7.shot_regenerations') IS NOT NULL AS available");
    if (!exists.rows[0]?.available) return [];
    const result = await this.db.query(`/* dashboard:list-shot-regenerations */
      SELECT sr.id, sr.request_id AS "requestId", sr.shot_id AS "shotId",
        sr.source_asset_id AS "sourceAssetId", sr.replacement_asset_id AS "replacementAssetId",
        sr.revision_no AS "revisionNo", sr.status, sr.expected_provider_calls AS "expectedProviderCalls",
        sr.provider, sr.model, sr.resolution, sr.recovery_kind AS "recoveryKind",
        sr.retry_reason AS "retryReason",sr.supersedes_asset_id AS "supersedesAssetId",
        sr.automatic_attempt AS "automaticAttempt",sr.result, sr.error, sr.created_at AS "createdAt"
      FROM v2_7.shot_regenerations sr JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND p.brand_id=$2 ORDER BY sr.created_at DESC`, [productionId, brandId]);
    return result.rows;
  }

  async latestShotRevision(productionId, brandId) {
    const result = await this.db.query(`/* dashboard:latest-shot-revision */
      SELECT sr.*, sr.canonical_raw_input AS "canonicalRawInput"
      FROM v2_7.shot_regenerations sr JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND p.brand_id=$2 AND sr.status='SUCCEEDED'
      ORDER BY sr.completed_at DESC LIMIT 1`, [productionId, brandId]);
    return result.rows[0] || null;
  }

  async nextShotRevision(productionId, shotId) {
    const result = await this.db.query(`SELECT coalesce(max(revision_no),0)::int + 1 AS revision
      FROM v2_7.shot_regenerations WHERE production_id=$1 AND shot_id=$2`, [productionId, shotId]);
    return result.rows[0].revision;
  }

  async countGeometryRecoveries(productionId, sourceAssetId, brandId) {
    const result = await this.db.query(`SELECT count(*)::int AS count FROM v2_7.shot_regenerations sr
      JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND sr.source_asset_id=$2 AND sr.recovery_kind='SOURCE_GEOMETRY'
        AND p.brand_id=$3 AND sr.brand_id=$3`, [productionId, sourceAssetId, brandId]);
    return result.rows[0]?.count || 0;
  }

  async latestSuccessfulGeometryRecovery(productionId, brandId, sourceAssetId) {
    const result = await this.db.query(`SELECT sr.*,sr.shot_id AS "shotId",sr.replacement_asset_id AS "replacementAssetId"
      FROM v2_7.shot_regenerations sr JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND sr.source_asset_id=$3 AND sr.recovery_kind='SOURCE_GEOMETRY'
        AND sr.status='SUCCEEDED' AND p.brand_id=$2 AND sr.brand_id=$2
        AND sr.workspace_id=p.workspace_id ORDER BY sr.completed_at DESC LIMIT 1`,
    [productionId, brandId, sourceAssetId]);
    return result.rows[0] || null;
  }

  async countCreativeRecoveries(productionId, sourceAssetId, brandId) {
    const result = await this.db.query(`SELECT count(*)::int AS count FROM v2_7.shot_regenerations sr
      JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND sr.source_asset_id=$2 AND sr.recovery_kind='SOURCE_CREATIVE'
        AND p.brand_id=$3 AND sr.brand_id=$3`, [productionId, sourceAssetId, brandId]);
    return result.rows[0]?.count || 0;
  }

  async latestSuccessfulCreativeRecovery(productionId, brandId, sourceAssetId) {
    const result = await this.db.query(`SELECT sr.*,sr.shot_id AS "shotId",sr.replacement_asset_id AS "replacementAssetId"
      FROM v2_7.shot_regenerations sr JOIN v2_1.productions p ON p.id=sr.production_id
      WHERE sr.production_id=$1 AND sr.source_asset_id=$3 AND sr.recovery_kind='SOURCE_CREATIVE'
        AND sr.status='SUCCEEDED' AND p.brand_id=$2 AND sr.brand_id=$2
        AND sr.workspace_id=p.workspace_id ORDER BY sr.completed_at DESC LIMIT 1`,
    [productionId, brandId, sourceAssetId]);
    return result.rows[0] || null;
  }

  async sourceMediaExecution(productionId, brandId, assetId) {
    const result = await this.db.query(`SELECT me.* FROM v2_5.media_executions me
      JOIN v2_1.productions p ON p.id=me.production_id
      WHERE me.production_id=$1 AND me.brand_id=$2 AND me.asset_id=$3
        AND p.brand_id=$2 AND p.workspace_id=me.workspace_id
      ORDER BY me.created_at DESC LIMIT 1`, [productionId, brandId, assetId]);
    return result.rows[0] || null;
  }

  async getShotRegenerationByRequest(productionId, requestId) {
    const result = await this.db.query(`SELECT *, input_fingerprint AS "inputFingerprint" FROM v2_7.shot_regenerations
      WHERE production_id=$1 AND request_id=$2`, [productionId, requestId]);
    return result.rows[0] || null;
  }

  async ensureShotRegeneration(record) {
    let result;
    try { result = await this.db.query(`/* dashboard:ensure-shot-regeneration */
      INSERT INTO v2_7.shot_regenerations(workspace_id,brand_id,production_id,request_id,shot_id,
        source_asset_id,replacement_asset_id,revision_no,status,input_fingerprint,canonical_raw_input,
        instruction,provider,model,resolution,recovery_kind,retry_reason,supersedes_asset_id,automatic_attempt)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PREPARED',$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(production_id,request_id) DO UPDATE SET updated_at=now()
      RETURNING *, canonical_raw_input AS "canonicalRawInput", replacement_asset_id AS "replacementAssetId",
        source_asset_id AS "sourceAssetId", revision_no AS "revisionNo"`,
    [record.workspaceId, record.brandId, record.productionId, record.requestId, record.shotId,
      record.sourceAssetId, record.replacementAssetId, record.revisionNo, record.inputFingerprint,
      JSON.stringify(record.canonicalRawInput), record.instruction, record.provider, record.model, record.resolution,
      record.recoveryKind || null, record.retryReason || null, record.supersedesAssetId || null, record.automaticAttempt || null]); }
    catch (error) {
      if (error.code === '23505' && error.constraint === 'shot_regenerations_one_automatic_geometry_attempt') {
        throw Object.assign(new Error('The one automatic geometry recovery attempt is already recorded for this asset'),
          { code: 'GEOMETRY_RECOVERY_LIMIT_REACHED' });
      }
      if (error.code === '23505' && error.constraint === 'shot_regenerations_one_automatic_creative_attempt') {
        throw Object.assign(new Error('The one automatic creative recovery attempt is already recorded for this asset'),
          { code: 'CREATIVE_RECOVERY_LIMIT_REACHED' });
      }
      if (error.code === '23505') throw Object.assign(new Error('Another shot regeneration is active for this production'), { code: 'SHOT_REGENERATION_ACTIVE' });
      throw error;
    }
    const row = result.rows[0];
    if (row.input_fingerprint !== record.inputFingerprint) throw Object.assign(new Error('requestId belongs to different shot regeneration input'), { code: 'SHOT_REGENERATION_CONFLICT' });
    return row;
  }

  async claimShotRegeneration(id, workerId) {
    const result = await this.db.query(`UPDATE v2_7.shot_regenerations SET status='RUNNING',worker_id=$2,
      started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$1 AND status IN ('PREPARED','RETRYING') RETURNING *`, [id, workerId]);
    return result.rows[0] || null;
  }

  async completeShotRegeneration(id, result) {
    await this.db.query(`UPDATE v2_7.shot_regenerations SET status='SUCCEEDED',result=$2::jsonb,error='{}'::jsonb,
      worker_id=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND status='RUNNING'`, [id, JSON.stringify(result)]);
  }

  async failShotRegeneration(id, error) {
    const retryable = error.code !== 'PROVIDER_OUTPUT_GEOMETRY_MISMATCH';
    await this.db.query(`UPDATE v2_7.shot_regenerations SET status=CASE WHEN recovery_kind IN ('SOURCE_GEOMETRY','SOURCE_CREATIVE') THEN 'FAILED' ELSE $3 END,error=$2::jsonb,
      worker_id=NULL,updated_at=now() WHERE id=$1 AND status='RUNNING'`, [id,
      JSON.stringify({ code: error.code || 'SHOT_REGENERATION_FAILED', message: error.message, details: error.details || null }),
      retryable ? 'RETRYING' : 'FAILED']);
  }

  async completeGeometryRecovery(id, { productionId, jobId, result }) {
    return this.completeSourceRecovery(id, { productionId, jobId, recoveryKind: 'SOURCE_GEOMETRY', result });
  }

  async completeSourceRecovery(id, { productionId, jobId, recoveryKind, result }) {
    const allowed = ['SOURCE_GEOMETRY','SOURCE_CREATIVE'];
    if (!allowed.includes(recoveryKind)) throw Object.assign(new Error('Unsupported bounded source recovery kind'),
      { code: 'SOURCE_RECOVERY_KIND_INVALID' });
    const geometry = recoveryKind === 'SOURCE_GEOMETRY';
    if (!jobId) throw Object.assign(new Error(`Exact failed job identity is required for same-production ${geometry ? 'geometry' : 'source'} recovery`),
      { code: geometry ? 'GEOMETRY_RECOVERY_JOB_ID_REQUIRED' : 'SOURCE_RECOVERY_JOB_ID_REQUIRED' });
    const payloadKey = recoveryKind === 'SOURCE_GEOMETRY' ? 'geometryRecovery' : 'sourceRecovery';
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE v2_7.shot_regenerations SET status='SUCCEEDED',result=$2::jsonb,
        error='{}'::jsonb,worker_id=NULL,completed_at=now(),updated_at=now()
        WHERE id=$1 AND status='RUNNING' AND recovery_kind=$3 RETURNING *`, [id, JSON.stringify(result), recoveryKind]);
      if (!updated.rows[0]) throw Object.assign(new Error(`${geometry ? 'Geometry' : 'Source'} recovery execution was fenced`),
        { code: geometry ? 'GEOMETRY_RECOVERY_FENCED' : 'SOURCE_RECOVERY_FENCED' });
      const resumed = await client.query(`UPDATE v2_1.jobs SET status='RETRYING',worker_id=NULL,lease_expires_at=NULL,next_attempt_at=now(),
        error=jsonb_build_object('code',$4::text,'message','Failed source was replaced immutably; continue the same execution.',
          'details',jsonb_build_object($5::text,$3::jsonb)),
        payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object($5::text,$3::jsonb),updated_at=now()
        WHERE id=$1 AND production_id=$2 AND status='FAILED' RETURNING id`,
      [jobId, productionId, JSON.stringify(result), `${recoveryKind}_RECOVERED`, payloadKey]);
      if (!resumed.rows[0]) throw Object.assign(new Error('Exact failed job could not be resumed'),
        { code: geometry ? 'GEOMETRY_RECOVERY_JOB_FENCED' : 'SOURCE_RECOVERY_JOB_FENCED' });
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
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
