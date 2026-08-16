-- V2.1 CONTINUITY database boundary.
-- CONTINUITY is deterministic: it proves that the durable BIBLE, SHOT_PLAN,
-- ASSET_PLAN and ASSETS outputs still describe one immutable production.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check CHECK (
    artifact_type IN (
      'SIGNAL_SET','IDEA_SET','CONTENT_BRIEF','CONCEPT','SCRIPT',
      'PRODUCTION_BIBLE','SHOTS','ASSET_REQUIREMENTS','ASSETS',
      'CONTINUITY_REPORT','EDIT','EDITIONS','VALIDATION_REPORT',
      'PUBLICATIONS','PERFORMANCE_DATA','LEARNINGS',
      'REFERENCE_IMAGE','IMAGE','VIDEO','VOICE','AUDIO','MUSIC','CAPTIONS',
      'FINAL_VIDEO','THUMBNAIL'
    )
  );

CREATE INDEX IF NOT EXISTS idx_v21_continuity_artifacts
  ON v2_1.artifacts(production_id, artifact_type, created_at DESC)
  WHERE artifact_type = 'CONTINUITY_REPORT';

CREATE OR REPLACE FUNCTION v2_1.enforce_continuity_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  report_count integer;
  unresolved_count integer;
  context_count integer;
  production_id uuid;
BEGIN
  IF NEW.stage <> 'CONTINUITY' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT production_id INTO production_id
    FROM v2_1.jobs
   WHERE id = NEW.job_id;

  SELECT count(*)::integer INTO report_count
    FROM v2_1.artifacts
   WHERE artifacts.production_id = production_id
     AND artifact_type = 'CONTINUITY_REPORT'
     AND status = 'VALID';

  IF report_count <> 1 THEN
    RAISE EXCEPTION 'CONTINUITY cannot complete without exactly one VALID CONTINUITY_REPORT artifact';
  END IF;

  SELECT count(*)::integer INTO unresolved_count
    FROM v2_1.asset_requirements ar
    JOIN v2_1.shots s ON s.id=ar.shot_id
   WHERE s.production_id=production_id
     AND (ar.status <> 'SATISFIED' OR ar.resolved_asset_id IS NULL OR ar.resolved_asset_version_id IS NULL);

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION 'CONTINUITY cannot complete while asset requirements remain unresolved';
  END IF;

  SELECT count(*)::integer INTO context_count
    FROM v2_1.shots s
    JOIN v2_1.productions p ON p.id=s.production_id
   WHERE s.production_id=production_id
     AND s.context_fingerprint=p.context_fingerprint;

  IF context_count <> (SELECT count(*)::integer FROM v2_1.shots WHERE shots.production_id=production_id) THEN
    RAISE EXCEPTION 'CONTINUITY cannot complete with SHOT_PLAN context drift';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_continuity_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_continuity_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_continuity_completion();

COMMENT ON FUNCTION v2_1.enforce_continuity_completion() IS
  'Database authority for the CONTINUITY boundary: durable report, complete asset resolution and immutable shot context are required before EDIT.';
