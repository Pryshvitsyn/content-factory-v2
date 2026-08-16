-- V2.1 EDIT hardening.
-- A production has exactly one canonical VALID EDIT artifact for the v1 boundary.
-- Concurrency is additionally serialized in the worker; this index is the database backstop.

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_canonical_edit_artifact
  ON v2_1.artifacts(production_id)
  WHERE artifact_type = 'EDIT' AND status = 'VALID';

CREATE INDEX IF NOT EXISTS idx_v21_edit_artifact_versions_context
  ON v2_1.artifact_versions(artifact_id, version)
  WHERE version = 1;

CREATE OR REPLACE FUNCTION v2_1.enforce_edit_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_production_id uuid;
  v_context text;
  v_continuity_id uuid;
  v_continuity_hash text;
  v_continuity_count integer;
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

  SELECT count(*)::integer
    INTO v_continuity_count
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'CONTINUITY_REPORT'
     AND a.status = 'VALID';

  IF v_continuity_count <> 1 THEN
    RAISE EXCEPTION 'EDIT cannot complete without exactly one VALID CONTINUITY_REPORT artifact';
  END IF;

  SELECT a.id, av.output_hash
    INTO v_continuity_id, v_continuity_hash
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'CONTINUITY_REPORT'
     AND a.status = 'VALID';

  SELECT count(*)::integer
    INTO v_edit_count
    FROM v2_1.artifacts a
    JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
   WHERE a.production_id = v_production_id
     AND a.artifact_type = 'EDIT'
     AND a.status = 'VALID'
     AND av.metadata->>'contextFingerprint' = v_context
     AND av.metadata->>'continuityArtifactId' = v_continuity_id::text
     AND av.metadata->>'continuityFingerprint' = v_continuity_hash;

  IF v_edit_count <> 1 THEN
    RAISE EXCEPTION 'EDIT cannot complete without exactly one canonical context-bound EDIT artifact';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON INDEX v2_1.uq_v21_canonical_edit_artifact IS
  'Exactly one VALID canonical EDIT artifact per production for V2.1 EDIT v1.';

COMMENT ON FUNCTION v2_1.enforce_edit_completion() IS
  'Database authority for EDIT: exactly one valid CONTINUITY_REPORT and exactly one context-bound canonical EDIT artifact tied to its hash are required.';
