'use strict';

const crypto = require('node:crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function buildResolutionFingerprint({ production, requirement, asset, assetVersion }) {
  return fingerprint({
    production: {
      id: production.id,
      contextFingerprint: production.context_fingerprint,
    },
    requirement: {
      id: requirement.id,
      shotId: requirement.shot_id,
      role: requirement.asset_role,
      type: requirement.required_asset_type,
      requiredAssetId: requirement.required_asset_id,
      constraints: requirement.constraints,
      planFingerprint: requirement.plan_fingerprint,
    },
    resolved: {
      assetId: asset.id,
      assetVersionId: assetVersion?.id || null,
      assetVersion: assetVersion?.version || null,
      identityFingerprint: asset.identity_fingerprint,
    },
  });
}

async function loadProductionOwnership(client, productionId) {
  const result = await client.query(
    `SELECT id, tenant_id, business_id, brand_id, context_fingerprint, status
       FROM v2_1.productions
      WHERE id = $1
      FOR SHARE`,
    [productionId]
  );
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.tenant_id || !production.business_id || !production.context_fingerprint) {
    throw new Error('Production ownership/context is incomplete');
  }
  return production;
}

function requiredAssetIdFromRequirement(requirement) {
  const constraints = requirement.constraints && typeof requirement.constraints === 'object'
    ? requirement.constraints : {};
  return requirement.required_asset_id || constraints.requiredAssetId || null;
}

async function resolveAssetRequirement({ client, production, requirement }) {
  const requestedAssetId = requiredAssetIdFromRequirement(requirement);
  if (!requestedAssetId) {
    return { requirementId: requirement.id, status: 'MISSING', reason: 'No canonical asset id was declared' };
  }

  const assetResult = await client.query(
    `SELECT id, tenant_id, business_id, brand_id, asset_type, name, identity_fingerprint, status
       FROM v2_1.assets
      WHERE id = $1`,
    [requestedAssetId]
  );
  const asset = assetResult.rows[0];
  if (!asset) return { requirementId: requirement.id, status: 'MISSING', reason: 'Canonical asset does not exist' };
  if (asset.status !== 'ACTIVE') return { requirementId: requirement.id, status: 'INVALID', reason: 'Canonical asset is not ACTIVE' };
  if (asset.tenant_id !== production.tenant_id || asset.business_id !== production.business_id) {
    throw new Error(`Asset ${asset.id} violates production tenant/business ownership`);
  }
  if (asset.brand_id && production.brand_id && asset.brand_id !== production.brand_id) {
    throw new Error(`Asset ${asset.id} violates production brand ownership`);
  }
  if (asset.asset_type !== requirement.required_asset_type) {
    throw new Error(`Asset ${asset.id} type ${asset.asset_type} does not satisfy ${requirement.required_asset_type}`);
  }

  const requestedVersion = requirement.constraints?.requiredAssetVersion ?? null;
  const versionResult = requestedVersion
    ? await client.query(
      `SELECT id, asset_id, version, data, source_artifact_id
         FROM v2_1.asset_versions
        WHERE asset_id = $1 AND version = $2`,
      [asset.id, requestedVersion]
    )
    : await client.query(
      `SELECT id, asset_id, version, data, source_artifact_id
         FROM v2_1.asset_versions
        WHERE asset_id = $1
        ORDER BY version DESC
        LIMIT 1`,
      [asset.id]
    );
  const assetVersion = versionResult.rows[0];
  if (!assetVersion) return { requirementId: requirement.id, status: 'STALE', reason: 'No usable asset version exists' };

  const resolutionFingerprint = buildResolutionFingerprint({ production, requirement, asset, assetVersion });
  if (requirement.resolved_asset_id) {
    if (requirement.resolved_asset_id !== asset.id || requirement.resolved_asset_version_id !== assetVersion.id || requirement.resolution_fingerprint !== resolutionFingerprint) {
      throw new Error(`Asset requirement ${requirement.id} has an immutable conflicting resolution`);
    }
    return { requirementId: requirement.id, status: 'SATISFIED', assetId: asset.id, assetVersionId: assetVersion.id, reused: true };
  }

  await client.query(
    `UPDATE v2_1.asset_requirements
        SET resolved_asset_id = $1,
            resolved_asset_version_id = $2,
            resolution_fingerprint = $3,
            status = 'SATISFIED'
      WHERE id = $4
        AND resolved_asset_id IS NULL
      RETURNING id`,
    [asset.id, assetVersion.id, resolutionFingerprint, requirement.id]
  );

  return { requirementId: requirement.id, status: 'SATISFIED', assetId: asset.id, assetVersionId: assetVersion.id, reused: false };
}

async function resolveProductionAssets({ client, productionId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId) throw new Error('productionId is required');

  const production = await loadProductionOwnership(client, productionId);
  const requirements = (await client.query(
    `SELECT ar.id, ar.shot_id, ar.asset_role, ar.required_asset_type, ar.required_asset_id,
            ar.constraints, ar.status, ar.plan_fingerprint, ar.resolved_asset_id,
            ar.resolved_asset_version_id, ar.resolution_fingerprint,
            s.production_id
       FROM v2_1.asset_requirements ar
       JOIN v2_1.shots s ON s.id = ar.shot_id
      WHERE s.production_id = $1
      ORDER BY s.shot_number, ar.asset_role, ar.id`,
    [productionId]
  )).rows;
  if (!requirements.length) throw new Error('ASSET_PLAN requirements are required before asset resolution');

  const results = [];
  await client.query('BEGIN');
  try {
    for (const requirement of requirements) {
      results.push(await resolveAssetRequirement({ client, production, requirement }));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    productionId,
    contextFingerprint: production.context_fingerprint,
    total: results.length,
    satisfied: results.filter((row) => row.status === 'SATISFIED').length,
    unresolved: results.filter((row) => row.status !== 'SATISFIED').length,
    results,
  };
}

module.exports = {
  stableStringify,
  fingerprint,
  buildResolutionFingerprint,
  requiredAssetIdFromRequirement,
  resolveAssetRequirement,
  resolveProductionAssets,
};
