BEGIN;

ALTER TABLE v2_7.shot_regenerations
  ADD COLUMN IF NOT EXISTS recovery_kind text,
  ADD COLUMN IF NOT EXISTS retry_reason text,
  ADD COLUMN IF NOT EXISTS supersedes_asset_id text,
  ADD COLUMN IF NOT EXISTS automatic_attempt integer;

ALTER TABLE v2_7.shot_regenerations DROP CONSTRAINT IF EXISTS v2102_geometry_attempt_check;
ALTER TABLE v2_7.shot_regenerations ADD CONSTRAINT v2102_geometry_attempt_check CHECK(
  (recovery_kind IS DISTINCT FROM 'SOURCE_GEOMETRY') OR
  (automatic_attempt = 1 AND supersedes_asset_id IS NOT NULL AND retry_reason IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS shot_regenerations_one_automatic_geometry_attempt
  ON v2_7.shot_regenerations(production_id,source_asset_id)
  WHERE recovery_kind='SOURCE_GEOMETRY' AND automatic_attempt=1;

-- Extend the existing ownership/immutability fence to the V2.10.2 lineage identity.
CREATE OR REPLACE FUNCTION v2_7.enforce_shot_regeneration_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE production_workspace uuid; production_brand uuid; brand_workspace uuid;
BEGIN
  SELECT workspace_id, brand_id INTO production_workspace, production_brand
  FROM v2_1.productions WHERE id=NEW.production_id;
  IF production_workspace IS NULL OR production_workspace <> NEW.workspace_id OR production_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'shot regeneration ownership mismatch';
  END IF;
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF brand_workspace IS NULL OR brand_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'shot regeneration brand ownership mismatch';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
    NEW.production_id IS DISTINCT FROM OLD.production_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR
    NEW.shot_id IS DISTINCT FROM OLD.shot_id OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id OR
    NEW.replacement_asset_id IS DISTINCT FROM OLD.replacement_asset_id OR NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint OR NEW.canonical_raw_input IS DISTINCT FROM OLD.canonical_raw_input OR
    NEW.provider IS DISTINCT FROM OLD.provider OR NEW.model IS DISTINCT FROM OLD.model OR NEW.resolution IS DISTINCT FROM OLD.resolution OR
    NEW.recovery_kind IS DISTINCT FROM OLD.recovery_kind OR NEW.retry_reason IS DISTINCT FROM OLD.retry_reason OR
    NEW.supersedes_asset_id IS DISTINCT FROM OLD.supersedes_asset_id OR NEW.automatic_attempt IS DISTINCT FROM OLD.automatic_attempt
  ) THEN RAISE EXCEPTION 'shot regeneration identity is immutable'; END IF;
  RETURN NEW;
END $$;

COMMIT;

-- Forward-only recovery: disable the V2.10.2 geometry route. Existing failed and replacement
-- artifacts plus regeneration lineage remain immutable evidence and must not be removed.
