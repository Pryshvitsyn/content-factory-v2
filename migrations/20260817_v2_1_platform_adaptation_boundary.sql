-- V2.1 PLATFORM_ADAPTATION database boundary.
-- The stage materializes platform editions from the canonical EDIT decision manifest.
-- Rendering and publication remain downstream boundaries.

CREATE OR REPLACE FUNCTION v2_1.enforce_platform_adaptation_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_production_id uuid;
  v_context text;
  v_edit_count integer;
  v_platforms jsonb;
  v_missing integer;
BEGIN
  IF NEW.stage <> 'PLATFORM_ADAPTATION' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT j.production_id INTO v_production_id
    FROM v2_1.jobs j WHERE j.id = NEW.job_id;
  SELECT p.context_fingerprint, COALESCE(p.request_snapshot->'targetPlatforms', p.request_snapshot->'platforms')
    INTO v_context, v_platforms
    FROM v2_1.productions p WHERE p.id = v_production_id;

  IF v_context IS NULL OR v_platforms IS NULL OR jsonb_typeof(v_platforms) <> 'array' OR jsonb_array_length(v_platforms) = 0 THEN
    RAISE EXCEPTION 'PLATFORM_ADAPTATION requires declared target platforms in production request';
  END IF;

  SELECT count(*)::integer INTO v_edit_count
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDIT'
     AND a.status = 'VALID'
     AND av.metadata->>'contextFingerprint' = v_context;
  IF v_edit_count <> 1 THEN
    RAISE EXCEPTION 'PLATFORM_ADAPTATION cannot complete without exactly one context-bound VALID EDIT artifact';
  END IF;

  SELECT count(*) INTO v_missing
    FROM jsonb_array_elements_text(v_platforms) requested(platform)
   WHERE NOT EXISTS (
     SELECT 1 FROM v2_1.editions e
     WHERE e.production_id = v_production_id
       AND e.platform = upper(requested.platform)
       AND e.version = 1
       AND e.metadata->>'contextFingerprint' = v_context
       AND e.metadata->>'stage' = 'PLATFORM_ADAPTATION'
   );
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'PLATFORM_ADAPTATION cannot complete until every requested platform has a context-bound canonical edition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_adaptation_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_platform_adaptation_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_platform_adaptation_completion();

CREATE INDEX IF NOT EXISTS idx_v21_editions_production_context
  ON v2_1.editions(production_id, platform, version);

COMMENT ON FUNCTION v2_1.enforce_platform_adaptation_completion() IS
  'Database authority for PLATFORM_ADAPTATION: every declared platform must have exactly one context-bound canonical edition derived from the valid EDIT boundary.';
