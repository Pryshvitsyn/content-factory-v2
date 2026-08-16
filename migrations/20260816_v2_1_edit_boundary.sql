-- V2.1 EDIT database boundary.
-- EDIT is the canonical, provider-neutral edit decision manifest.
-- Rendering is downstream; this boundary records exactly what must be edited.

CREATE OR REPLACE FUNCTION v2_1.enforce_edit_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_production_id uuid;
  v_context text;
  v_report_count integer;
  v_edit_count integer;
BEGIN
  IF NEW.stage <> 'EDIT' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT j.production_id INTO v_production_id
    FROM v2_1.jobs j
   WHERE j.id = NEW.job_id;

  SELECT p.context_fingerprint INTO v_context
    FROM v2_1.productions p
   WHERE p.id = v_production_id;

  SELECT count(*)::integer INTO v_report_count
    FROM v2_1.artifacts a
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'CONTINUITY_REPORT'
     AND a.status = 'VALID';

  IF v_report_count <> 1 THEN
    RAISE EXCEPTION 'EDIT cannot complete without exactly one VALID CONTINUITY_REPORT artifact';
  END IF;

  SELECT count(*)::integer INTO v_edit_count
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDIT'
     AND a.status = 'VALID'
     AND av.version = 1
     AND av.metadata->>'contextFingerprint' = v_context;

  IF v_edit_count <> 1 THEN
    RAISE EXCEPTION 'EDIT cannot complete without exactly one VALID context-bound EDIT artifact version 1';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edit_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_edit_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_edit_completion();

CREATE INDEX IF NOT EXISTS idx_v21_edit_artifacts
  ON v2_1.artifacts(production_id, artifact_type, created_at DESC)
  WHERE artifact_type = 'EDIT';

COMMENT ON FUNCTION v2_1.enforce_edit_completion() IS
  'Database authority for EDIT: a valid CONTINUITY_REPORT and exactly one context-bound canonical EDIT artifact are required.';
