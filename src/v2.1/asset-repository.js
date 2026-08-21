'use strict';

class PostgresAssetRepository {
  async findReusable({ client, productionId, asset }) {
    const result = await client.query(
      `SELECT id, asset_id, kind, artifact_storage_key AS "storageKey", artifact_version AS version
         FROM v2_1.asset_registry
        WHERE asset_id=$1
          AND kind=$2
          AND (production_id=$3 OR production_id IS NULL)
          AND status='READY'
        ORDER BY CASE WHEN production_id=$3 THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1`,
      [asset.asset_id, asset.kind, productionId],
    );
    return result.rows[0] || null;
  }

  async registerResolved({ client, productionId, asset, artifact, workerId, key }) {
    const result = await client.query(
      `INSERT INTO v2_1.asset_registry
        (production_id, asset_id, kind, semantic_key, artifact_storage_key, artifact_version, status, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'READY',$7::jsonb,$8)
       ON CONFLICT (production_id, asset_id) DO UPDATE SET
         kind=EXCLUDED.kind,
         semantic_key=EXCLUDED.semantic_key,
         artifact_storage_key=EXCLUDED.artifact_storage_key,
         artifact_version=EXCLUDED.artifact_version,
         status='READY',
         metadata=EXCLUDED.metadata,
         created_by=EXCLUDED.created_by,
         updated_at=now()
       RETURNING id, asset_id, kind, artifact_storage_key AS "storageKey", artifact_version AS version`,
      [productionId, asset.asset_id, asset.kind, key, artifact.storageKey, artifact.version, JSON.stringify({ workerId, source: 'provider', description: asset.description }), workerId],
    );
    return result.rows[0];
  }
}

module.exports = { PostgresAssetRepository };
