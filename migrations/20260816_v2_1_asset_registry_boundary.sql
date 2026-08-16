-- V2.1 reusable asset registry boundary.
-- Assets are tenant/business/brand-scoped creative truth. A production may
-- resolve only assets owned by the same tenant/business and, when present,
-- the same brand. Asset identity is immutable; new creative truth requires a
-- new asset version.

ALTER TABLE v2_1.assets
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES v2_1.tenants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS identity_fingerprint text,
  ADD COLUMN IF NOT EXISTS continuity_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_v21_assets_scope
  ON v2_1.assets(tenant_id, business_id, brand_id, asset_type, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_asset_identity
  ON v2_1.assets(tenant_id, business_id, COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), asset_type, name)
  WHERE tenant_id IS NOT NULL AND business_id IS NOT NULL;

ALTER TABLE v2_1.asset_requirements
  ADD COLUMN IF NOT EXISTS resolved_asset_id uuid REFERENCES v2_1.assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resolved_asset_version_id uuid REFERENCES v2_1.asset_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resolution_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_v21_asset_requirements_resolution
  ON v2_1.asset_requirements(resolved_asset_id, resolved_asset_version_id)
  WHERE resolved_asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION v2_1.enforce_asset_registry_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_row uuid;
  brand_business uuid;
  asset_business uuid;
  asset_tenant uuid;
  production_row record;
BEGIN
  IF TG_TABLE_NAME = 'assets' THEN
    IF NEW.tenant_id IS NULL OR NEW.business_id IS NULL THEN
      IF NEW.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Active asset % requires tenant and business ownership', NEW.id;
      END IF;
      RETURN NEW;
    END IF;

    SELECT tenant_id INTO tenant_row FROM v2_1.businesses WHERE id = NEW.business_id;
    IF tenant_row IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'Asset business % does not belong to tenant %', NEW.business_id, NEW.tenant_id;
    END IF;

    IF NEW.brand_id IS NOT NULL THEN
      SELECT business_id INTO brand_business FROM v2_1.brands WHERE id = NEW.brand_id;
      IF brand_business IS DISTINCT FROM NEW.business_id THEN
        RAISE EXCEPTION 'Asset brand % does not belong to business %', NEW.brand_id, NEW.business_id;
      END IF;
    END IF;

    IF NEW.identity_fingerprint IS NULL OR btrim(NEW.identity_fingerprint) = '' THEN
      RAISE EXCEPTION 'Asset identity_fingerprint is required';
    END IF;

    IF TG_OP = 'UPDATE' AND (
      OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
      OLD.business_id IS DISTINCT FROM NEW.business_id OR
      OLD.brand_id IS DISTINCT FROM NEW.brand_id OR
      OLD.asset_type IS DISTINCT FROM NEW.asset_type OR
      OLD.name IS DISTINCT FROM NEW.name OR
      OLD.identity_fingerprint IS DISTINCT FROM NEW.identity_fingerprint OR
      OLD.canonical_data IS DISTINCT FROM NEW.canonical_data
    ) THEN
      RAISE EXCEPTION 'Asset identity/canonical data is immutable; create a new asset version';
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.tenant_id, p.business_id, p.brand_id
    INTO production_row
    FROM v2_1.productions p
    JOIN v2_1.shots s ON s.production_id = p.id
   WHERE s.id = NEW.shot_id;

  IF production_row.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Asset requirement % has no production ownership context', NEW.id;
  END IF;

  IF NEW.resolved_asset_id IS NOT NULL THEN
    SELECT a.tenant_id, a.business_id, a.brand_id
      INTO asset_tenant, asset_business, NEW.brand_id
      FROM v2_1.assets a
     WHERE a.id = NEW.resolved_asset_id;

    IF asset_tenant IS NULL THEN
      RAISE EXCEPTION 'Resolved asset % does not exist or is not tenant-scoped', NEW.resolved_asset_id;
    END IF;

    IF asset_tenant IS DISTINCT FROM production_row.tenant_id
       OR asset_business IS DISTINCT FROM production_row.business_id
       OR (NEW.brand_id IS NOT NULL AND NEW.brand_id IS DISTINCT FROM production_row.brand_id) THEN
      RAISE EXCEPTION 'Resolved asset % violates production ownership boundary', NEW.resolved_asset_id;
    END IF;

    IF NEW.resolved_asset_version_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM v2_1.asset_versions av
         WHERE av.id = NEW.resolved_asset_version_id
           AND av.asset_id = NEW.resolved_asset_id
      ) THEN
        RAISE EXCEPTION 'Resolved asset version % does not belong to asset %', NEW.resolved_asset_version_id, NEW.resolved_asset_id;
      END IF;
    END IF;
  END IF;

  IF NEW.resolution_fingerprint IS NULL AND NEW.resolved_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Resolved asset requirements require resolution_fingerprint';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.resolved_asset_id IS DISTINCT FROM NEW.resolved_asset_id OR
    OLD.resolved_asset_version_id IS DISTINCT FROM NEW.resolved_asset_version_id OR
    OLD.resolution_fingerprint IS DISTINCT FROM NEW.resolution_fingerprint
  ) AND OLD.resolved_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Asset resolution is immutable once established; create a new planning version';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assets_registry_boundary ON v2_1.assets;
CREATE TRIGGER trg_assets_registry_boundary
BEFORE INSERT OR UPDATE ON v2_1.assets
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_asset_registry_boundary();

DROP TRIGGER IF EXISTS trg_asset_requirements_registry_boundary ON v2_1.asset_requirements;
CREATE TRIGGER trg_asset_requirements_registry_boundary
BEFORE INSERT OR UPDATE ON v2_1.asset_requirements
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_asset_registry_boundary();

CREATE OR REPLACE FUNCTION v2_1.enforce_production_bible_asset_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p record;
  a record;
BEGIN
  SELECT tenant_id, business_id, brand_id INTO p
    FROM v2_1.productions
   WHERE id = (SELECT production_id FROM v2_1.production_bibles WHERE id = NEW.production_bible_id);

  SELECT tenant_id, business_id, brand_id INTO a
    FROM v2_1.assets WHERE id = NEW.asset_id;

  IF p.tenant_id IS NULL OR a.tenant_id IS NULL THEN
    RAISE EXCEPTION 'BIBLE asset links require tenant-scoped production and asset';
  END IF;
  IF p.tenant_id IS DISTINCT FROM a.tenant_id
     OR p.business_id IS DISTINCT FROM a.business_id
     OR (a.brand_id IS NOT NULL AND a.brand_id IS DISTINCT FROM p.brand_id) THEN
    RAISE EXCEPTION 'Production BIBLE cannot reference an asset owned by another tenant/business/brand';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_bible_asset_boundary ON v2_1.production_bible_assets;
CREATE TRIGGER trg_production_bible_asset_boundary
BEFORE INSERT OR UPDATE ON v2_1.production_bible_assets
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_production_bible_asset_boundary();

COMMENT ON TABLE v2_1.assets IS
  'Reusable creative asset registry. Active assets are tenant/business scoped and their canonical identity is immutable.';
COMMENT ON COLUMN v2_1.assets.identity_fingerprint IS
  'Deterministic identity of the reusable asset definition; changes require a new asset/version.';
COMMENT ON COLUMN v2_1.asset_requirements.resolved_asset_id IS
  'Canonical reusable asset selected for this production requirement after ownership validation.';
COMMENT ON COLUMN v2_1.asset_requirements.resolution_fingerprint IS
  'Deterministic record of the asset resolution decision.';
