BEGIN;

ALTER TABLE v2_7.shot_regenerations DROP CONSTRAINT IF EXISTS v2104_source_creative_attempt_check;
ALTER TABLE v2_7.shot_regenerations ADD CONSTRAINT v2104_source_creative_attempt_check CHECK(
  (recovery_kind IS DISTINCT FROM 'SOURCE_CREATIVE') OR
  (automatic_attempt = 1 AND supersedes_asset_id IS NOT NULL AND retry_reason = 'CREATIVE_PLAN_MISMATCH'));

CREATE UNIQUE INDEX IF NOT EXISTS shot_regenerations_one_automatic_creative_attempt
  ON v2_7.shot_regenerations(production_id,source_asset_id)
  WHERE recovery_kind='SOURCE_CREATIVE' AND automatic_attempt=1;

COMMIT;

-- Forward-only recovery: disable the SOURCE_CREATIVE route in application configuration.
-- Existing failed artifacts, accepted replacements, provider executions, and lineage remain immutable evidence.
