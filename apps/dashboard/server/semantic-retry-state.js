'use strict';

function installSemanticRetryState(repository) {
  if (!repository?.db || typeof repository.db.query !== 'function') throw new Error('repository.db is required');

  repository.latestSemanticRetryAttempt = async (productionId, brandId, assetId) => {
    const available = await repository.db.query("SELECT to_regclass('v2_9.semantic_evaluation_attempts') IS NOT NULL AS ready");
    if (!available.rows[0]?.ready) return null;
    const result = await repository.db.query(`/* dashboard:v2.9.2.6:semantic-retry-pass-history */
      SELECT sea.* FROM v2_9.semantic_evaluation_attempts sea
      JOIN v2_1.productions p ON p.id=sea.production_id
      WHERE sea.production_id=$1 AND sea.brand_id=$2 AND sea.asset_id=$3
        AND p.brand_id=$2 AND p.workspace_id=sea.workspace_id
      ORDER BY CASE
        WHEN sea.status IN ('FAILED','SUCCEEDED')
          AND sea.result_evidence->>'status'='PASS'
          AND sea.result_evidence->'semantic'->>'status'='PASS'
        THEN 0 ELSE 1 END,
        sea.attempt DESC
      LIMIT 1`, [productionId, brandId, assetId]);
    return result.rows[0] || null;
  };

  repository.activeSemanticRetryAttempt = async (productionId, brandId, assetId = null) => {
    const available = await repository.db.query("SELECT to_regclass('v2_9.semantic_evaluation_attempts') IS NOT NULL AS ready");
    if (!available.rows[0]?.ready) return null;
    const result = await repository.db.query(`/* dashboard:v2.9.2.6:active-semantic-retry */
      SELECT sea.* FROM v2_9.semantic_evaluation_attempts sea
      JOIN v2_1.productions p ON p.id=sea.production_id
      WHERE sea.production_id=$1 AND sea.brand_id=$2 AND ($3::text IS NULL OR sea.asset_id=$3)
        AND sea.status='RUNNING' AND p.brand_id=$2 AND p.workspace_id=sea.workspace_id
      ORDER BY sea.attempt DESC LIMIT 1`, [productionId, brandId, assetId]);
    return result.rows[0] || null;
  };

  return repository;
}

module.exports = { installSemanticRetryState };
