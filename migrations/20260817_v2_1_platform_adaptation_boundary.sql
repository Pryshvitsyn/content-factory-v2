-- V2.1 PLATFORM_ADAPTATION database boundary.
-- This stage creates deterministic platform edition manifests from the canonical EDIT.
-- It does not render media or call a provider.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check CHECK (artifact_type IN (
    'IDEA_SET','CONTENT_BRIEF','CONCEPT','SCRIPT','PRODUCTION_BIBLE',
    'SHOTS','ASSET_REQUIREMENTS','ASSETS','CONTINUITY_REPORT','EDIT','EDITIONS',
    'REFERENCE_IMAGE','IMAGE','VIDEO','VOICE','AUDIO','MUSIC','CAPTIONS',
    'FINAL_VIDEO','THUMBNAIL'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_canonical_editions_artifact
  ON v2_1.artifacts(production_id)
  WHERE artifact_type = 'EDITIONS' AND status = 'VALID';

CREATE INDEX IF NOT EXISTS idx_v21_editions_artifact
  ON v2_1.editions(artifact_id, platform, version);

CREATE OR REPLACE FUNCTION v2_1.enforce_platform_adaptation_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_production_id uuid;
  v_context text;
  v_edit_id uuid;
  v_edit_hash text;
  v_edit_count integer;
  v_editions_count integer;
  v_manifest_count integer;
BEGIN
  IF NEW.stage <> 'PLATFORM_ADAPTATION' OR NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT j.production_id INTO v_production_id
    FROM v2_1.jobs j
   WHERE j.id = NEW.job_id;

  SELECT p.context_fingerprint INTO v_context
    FROM v2_1.productions p
   WHERE p.id = v_production_id;

  SELECT count(*)::integer, min(a.id), min(av.output_hash)
    INTO v_edit_count, v_edit_id, v_edit_hash
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDIT'
     AND a.status = 'VALID';

  IF v_edit_count <> 1 THEN
    RAISE EXCEPTION 'PLATFORM_ADAPTATION cannot complete without exactly one VALID EDIT artifact';
  END IF;

  SELECT count(*)::integer
    INTO v_editions_count
    FROM v2_1.editions e
   WHERE e.production_id = v_production_id
     AND e.version = 1;

  SELECT count(*)::integer
    INTO v_manifest_count
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDITIONS'
     AND a.status = 'VALID'
     AND av.metadata->>'contextFingerprint' = v_context
     AND av.metadata->>'editArtifactId' = v_edit_id::text
     AND av.metadata->>'editFingerprint' = v_edit_hash;

  IF v_editions_count < 1 OR v_manifest_count <> 1 THEN
    RAISE EXCEPTION 'PLATFORM_ADAPTATION cannot complete without one context-bound EDITIONS artifact and at least one edition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_adaptation_completion ON v2_1.stage_runs;
CREATE TRIGGER trg_platform_adaptation_completion
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_platform_adaptation_completion();

COMMENT ON FUNCTION v2_1.enforce_platform_adaptation_completion() IS
  'Database authority for PLATFORM_ADAPTATION: canonical EDIT provenance, immutable context, and durable platform editions are required.';
