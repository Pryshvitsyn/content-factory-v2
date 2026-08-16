-- V2.1 ASSET_GENERATION database boundary.
-- Generation is provider-executable but database-owned: request identity,
-- production ownership, artifact provenance and completed-stage output are durable.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check CHECK (
    artifact_type IN (
      'SIGNAL_SET', 'IDEA_SET', 'CONTENT_BRIEF', 'CONCEPT', 'SCRIPT',
      'PRODUCTION_BIBLE', 'SHOTS', 'ASSET_REQUIREMENTS', 'ASSETS',
      'CONTINUITY_REPORT', 'EDIT', 'EDITIONS', 'VALIDATION_REPORT',
      'PUBLICATIONS', 'PERFORMANCE_DATA', 'LEARNINGS'
    )
  );

CREATE INDEX IF NOT EXISTS idx_v21_generation_runs_stage_request
  ON v2_1.generation_runs(stage_run_id, request_hash, created_at DESC);

CREATE OR REPLACE FUNCTION v2_1.enforce_generation_run_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stage_row record;
  artifact_production uuid;
BEGIN
  IF NEW.request_hash IS NULL OR btrim(NEW.request_hash) = '' THEN
    RAISE EXCEPTION 'Generation run request_hash is required';
  END IF;

  SELECT sr.stage, sr.job_id, j.production_id
    INTO stage_row
    FROM v2_1.stage_runs sr
    JOIN v2_1.jobs j ON j.id = sr.job_id
   WHERE sr.id = NEW.stage_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Generation run % references a missing stage run', NEW.id;
  END IF;

  IF NEW.artifact_id IS NOT NULL THEN
    SELECT production_id INTO artifact_production
      FROM v2_1.artifacts WHERE id = NEW.artifact_id;
    IF artifact_production IS DISTINCT FROM stage_row.production_id THEN
      RAISE EXCEPTION 'Generation artifact % belongs to a different production', NEW.artifact_id;
    END IF;
  END IF;

  IF NEW.stage_run_id IS NOT NULL AND NEW.capability IS NULL THEN
    RAISE EXCEPTION 'Generation capability is required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generation_runs_boundary ON v2_1.generation_runs;
CREATE TRIGGER trg_generation_runs_boundary
BEFORE INSERT OR UPDATE ON v2_1.generation_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_generation_run_boundary();

CREATE OR REPLACE FUNCTION v2_1.enforce_asset_generation_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_count integer;
  artifact_id uuid;
BEGIN
  IF NEW.stage <> 'ASSET_GENERATION' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT count(*), max(gr.artifact_id)
    INTO run_count, artifact_id
    FROM v2_1.generation_runs gr
   WHERE gr.stage_run_id = NEW.id
     AND gr.status = 'COMPLETED'
     AND gr.artifact_id IS NOT NULL;

  IF run_count <> 1 OR artifact_id IS NULL THEN
    RAISE EXCEPTION 'ASSET_GENERATION cannot complete without exactly one completed generation run and output artifact';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM v2_1.artifacts a
     WHERE a.id = artifact_id
       AND a.artifact_type = 'ASSETS'
  ) THEN
    RAISE EXCEPTION 'ASSET_GENERATION output artifact must be ASSETS';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_generation_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_asset_generation_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_asset_generation_completion();

COMMENT ON FUNCTION v2_1.enforce_generation_run_boundary() IS
  'Database boundary for durable generation provenance and production ownership.';
COMMENT ON FUNCTION v2_1.enforce_asset_generation_completion() IS
  'ASSET_GENERATION may complete only after one durable generation run produced an ASSETS artifact.';
