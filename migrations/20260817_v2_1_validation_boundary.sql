-- V2.1 VALIDATION database boundary.
-- VALIDATION consumes canonical PLATFORM_ADAPTATION editions and produces one immutable report.
-- It does not publish, render, analyze, or learn.

ALTER TABLE v2_1.artifacts DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;
ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check
  CHECK (artifact_type IN ('SCRIPT','PRODUCTION_BIBLE','REFERENCE_IMAGE','IMAGE','VIDEO','VOICE','AUDIO','MUSIC','CAPTIONS','EDIT','FINAL_VIDEO','THUMBNAIL','VALIDATION_REPORT'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_canonical_validation_report
  ON v2_1.artifacts(production_id)
  WHERE artifact_type = 'VALIDATION_REPORT' AND status = 'VALID';

CREATE INDEX IF NOT EXISTS idx_v21_validation_report_versions
  ON v2_1.artifact_versions(artifact_id, version)
  WHERE version = 1;

CREATE OR REPLACE FUNCTION v2_1.enforce_validation_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_production_id uuid;
  v_context text;
  v_platforms jsonb;
  v_requested_count integer;
  v_edit_count integer;
  v_edit_artifact_id uuid;
  v_edit_fingerprint text;
  v_edition_count integer;
  v_valid_edition_count integer;
  v_missing integer;
  v_report_count integer;
  v_report_artifact_id uuid;
  v_report_hash text;
  v_report_context text;
  v_report_source_edit_id text;
  v_report_source_edit_hash text;
BEGIN
  IF NEW.stage <> 'VALIDATION' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT j.production_id INTO v_production_id
    FROM v2_1.jobs j WHERE j.id = NEW.job_id;
  SELECT p.context_fingerprint,
         COALESCE(p.request_snapshot->'targetPlatforms', p.request_snapshot->'platforms')
    INTO v_context, v_platforms
    FROM v2_1.productions p WHERE p.id = v_production_id;

  IF v_context IS NULL OR v_platforms IS NULL OR jsonb_typeof(v_platforms) <> 'array' OR jsonb_array_length(v_platforms) = 0 THEN
    RAISE EXCEPTION 'VALIDATION requires declared target platforms';
  END IF;

  SELECT count(*)::integer INTO v_requested_count
    FROM jsonb_array_elements_text(v_platforms) requested(platform);
  IF v_requested_count <> (SELECT count(DISTINCT upper(value)) FROM jsonb_array_elements_text(v_platforms) value) THEN
    RAISE EXCEPTION 'VALIDATION target platform declaration contains duplicates';
  END IF;

  SELECT count(*)::integer,
         min(a.id),
         min(av.output_hash)
    INTO v_edit_count, v_edit_artifact_id, v_edit_fingerprint
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDIT'
     AND a.status = 'VALID'
     AND av.metadata->>'contextFingerprint' = v_context;
  IF v_edit_count <> 1 OR v_edit_artifact_id IS NULL OR v_edit_fingerprint IS NULL THEN
    RAISE EXCEPTION 'VALIDATION requires exactly one context-bound VALID EDIT artifact';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE e.metadata->>'contextFingerprint' = v_context
             AND e.metadata->>'stage' = 'PLATFORM_ADAPTATION'
             AND e.metadata->>'sourceEditArtifactId' = v_edit_artifact_id::text
             AND e.metadata->>'sourceEditFingerprint' = v_edit_fingerprint
         )::integer
    INTO v_edition_count, v_valid_edition_count
    FROM v2_1.editions e
   WHERE e.production_id = v_production_id AND e.version = 1;

  SELECT count(*)::integer INTO v_missing
    FROM jsonb_array_elements_text(v_platforms) requested(platform)
   WHERE NOT EXISTS (
     SELECT 1 FROM v2_1.editions e
      WHERE e.production_id = v_production_id
        AND e.platform = upper(requested.platform)
        AND e.version = 1
        AND e.metadata->>'contextFingerprint' = v_context
        AND e.metadata->>'stage' = 'PLATFORM_ADAPTATION'
        AND e.metadata->>'sourceEditArtifactId' = v_edit_artifact_id::text
        AND e.metadata->>'sourceEditFingerprint' = v_edit_fingerprint
   );
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'VALIDATION cannot complete until every requested platform has a canonical context-bound edition derived from the canonical EDIT';
  END IF;

  IF v_edition_count <> v_requested_count OR v_valid_edition_count <> v_requested_count THEN
    RAISE EXCEPTION 'VALIDATION requires exactly one valid canonical edition per requested platform';
  END IF;

  IF NOT (NEW.output_artifacts @> '["VALIDATION_REPORT"]'::jsonb) THEN
    RAISE EXCEPTION 'VALIDATION completion must declare VALIDATION_REPORT in output_artifacts';
  END IF;

  SELECT count(*)::integer,
         min(a.id),
         min(av.output_hash),
         min(av.metadata->>'contextFingerprint'),
         min(av.metadata->>'sourceEditArtifactId'),
         min(av.metadata->>'sourceEditFingerprint')
    INTO v_report_count, v_report_artifact_id, v_report_hash,
         v_report_context, v_report_source_edit_id, v_report_source_edit_hash
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'VALIDATION_REPORT'
     AND a.status = 'VALID';

  IF v_report_count <> 1 OR v_report_artifact_id IS NULL OR v_report_hash IS NULL THEN
    RAISE EXCEPTION 'VALIDATION requires exactly one canonical VALID VALIDATION_REPORT artifact with v1';
  END IF;
  IF v_report_context IS DISTINCT FROM v_context THEN
    RAISE EXCEPTION 'VALIDATION_REPORT context provenance does not match production context';
  END IF;
  IF v_report_source_edit_id IS DISTINCT FROM v_edit_artifact_id::text
     OR v_report_source_edit_hash IS DISTINCT FROM v_edit_fingerprint THEN
    RAISE EXCEPTION 'VALIDATION_REPORT EDIT provenance does not match canonical EDIT';
  END IF;
  IF NEW.output_fingerprint IS DISTINCT FROM v_report_hash THEN
    RAISE EXCEPTION 'VALIDATION output fingerprint must equal canonical VALIDATION_REPORT hash';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validation_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_validation_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts, output_fingerprint ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_validation_completion();

COMMENT ON FUNCTION v2_1.enforce_validation_completion() IS
  'Database authority for VALIDATION: exactly one canonical context-bound edition derived from the canonical EDIT must exist for every requested platform, and the stage must point to exactly one provenance-bound v1 VALIDATION_REPORT whose hash matches output_fingerprint.';
