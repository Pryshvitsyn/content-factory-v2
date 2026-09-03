'use strict';

const { CANONICAL_BRANDS, brandMetadata, validateCanonicalBrands } = require('./canonical-brands');

class CanonicalBrandRegistryError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = 'CanonicalBrandRegistryError'; this.code = code; this.details = details;
  }
}

async function resolveWorkspace(db, explicitWorkspaceId = null) {
  if (explicitWorkspaceId) {
    const exact = await db.query('SELECT id FROM workspaces WHERE id=$1', [explicitWorkspaceId]);
    if (!exact.rows[0]) throw new CanonicalBrandRegistryError('CANONICAL_BRAND_WORKSPACE_NOT_FOUND',
      `Workspace '${explicitWorkspaceId}' does not exist`);
    return exact.rows[0].id;
  }
  const result = await db.query('SELECT id FROM workspaces ORDER BY created_at NULLS LAST,id LIMIT 2');
  if (!result.rows.length) throw new CanonicalBrandRegistryError('CANONICAL_BRAND_WORKSPACE_MISSING',
    'No Content Factory workspace exists');
  if (result.rows.length > 1) throw new CanonicalBrandRegistryError('CANONICAL_BRAND_WORKSPACE_REQUIRED',
    'Multiple workspaces exist. Set CONTENT_FACTORY_WORKSPACE_ID before synchronizing canonical brands.');
  return result.rows[0].id;
}

async function findCanonicalOrAlias(db, workspaceId, brand) {
  const exact = await db.query(`SELECT * FROM v2_2.brands
    WHERE workspace_id=$1 AND (slug=$2 OR lower(name)=lower($3))
    ORDER BY CASE WHEN slug=$2 THEN 0 ELSE 1 END,created_at LIMIT 1`, [workspaceId, brand.slug, brand.name]);
  if (exact.rows[0]) return { row: exact.rows[0], migratedLegacyAlias: false };
  if (brand.slug !== 'tune-into-her') return { row: null, migratedLegacyAlias: false };
  const legacy = await db.query(`SELECT * FROM v2_2.brands
    WHERE workspace_id=$1 AND (lower(slug)='attune' OR lower(name)='attune')
    ORDER BY created_at LIMIT 1`, [workspaceId]);
  return { row: legacy.rows[0] || null, migratedLegacyAlias: Boolean(legacy.rows[0]) };
}

async function persistBrand(db, workspaceId, brand) {
  const metadata = brandMetadata(brand);
  const found = await findCanonicalOrAlias(db, workspaceId, brand);
  if (found.row) {
    const slugOwner = await db.query('SELECT id FROM v2_2.brands WHERE workspace_id=$1 AND slug=$2 AND id<>$3',
      [workspaceId, brand.slug, found.row.id]);
    if (slugOwner.rows[0]) throw new CanonicalBrandRegistryError('CANONICAL_BRAND_SLUG_CONFLICT',
      `Canonical slug '${brand.slug}' is already owned by another brand`, { canonicalName: brand.name });
    const updated = await db.query(`UPDATE v2_2.brands SET name=$3,slug=$4,status='ACTIVE',
      metadata=coalesce(metadata,'{}'::jsonb) || $5::jsonb,updated_at=now()
      WHERE id=$1 AND workspace_id=$2 RETURNING *`,
    [found.row.id, workspaceId, brand.name, brand.slug, JSON.stringify({ ...metadata,
      ...(found.migratedLegacyAlias ? { migratedFromLegacyAlias: 'Attune' } : {}) })]);
    return { row: updated.rows[0], created: false, migratedLegacyAlias: found.migratedLegacyAlias };
  }
  const inserted = await db.query(`INSERT INTO v2_2.brands(workspace_id,name,slug,status,metadata)
    VALUES($1,$2,$3,'ACTIVE',$4::jsonb) RETURNING *`, [workspaceId, brand.name, brand.slug, JSON.stringify(metadata)]);
  return { row: inserted.rows[0], created: true, migratedLegacyAlias: false };
}

async function archiveDuplicateAttuneAliases(db, workspaceId, canonicalTuneIntoHerId) {
  const result = await db.query(`UPDATE v2_2.brands SET status='ARCHIVED',
    metadata=coalesce(metadata,'{}'::jsonb) || $3::jsonb,updated_at=now()
    WHERE workspace_id=$1 AND id<>$2 AND (lower(slug)='attune' OR lower(name)='attune')
    RETURNING id,name,slug,status`, [workspaceId, canonicalTuneIntoHerId, JSON.stringify({
      canonicalRegistry: false,
      canonicalStatus: 'LEGACY_ALIAS',
      legacyAliasOf: 'Tune Into Her',
      newProductionEligible: false,
    })]);
  return result.rows;
}

async function syncCanonicalBrands({ db, workspaceId = null } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('db is required');
  validateCanonicalBrands();
  const resolvedWorkspaceId = await resolveWorkspace(db, workspaceId);
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const brands = [];
    for (const brand of CANONICAL_BRANDS) {
      const result = await persistBrand(client, resolvedWorkspaceId, brand);
      brands.push({ id: result.row.id, name: result.row.name, slug: result.row.slug,
        status: result.row.status, created: result.created, migratedLegacyAlias: result.migratedLegacyAlias });
    }
    const tune = brands.find((brand) => brand.slug === 'tune-into-her');
    const archivedLegacyAliases = tune ? await archiveDuplicateAttuneAliases(client, resolvedWorkspaceId, tune.id) : [];
    await client.query('COMMIT');
    return Object.freeze({ workspaceId: resolvedWorkspaceId, canonicalCount: brands.length,
      brands: Object.freeze(brands), archivedLegacyAliases: Object.freeze(archivedLegacyAliases) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { if (client !== db) client.release(); }
}

module.exports = { CanonicalBrandRegistryError, resolveWorkspace, syncCanonicalBrands };
