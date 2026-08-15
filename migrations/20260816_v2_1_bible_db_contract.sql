-- V2.1 BIBLE database contract.
-- BIBLE is a durable production specification, not merely another JSON artifact.
-- The database stores the canonical document, its immutable context fingerprint,
-- and exact SCRIPT provenance. Provider/model details remain in generation_runs.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check
  CHECK (artifact_type IN (
    'SCRIPT','PRODUCTION_BIBLE','REFERENCE_IMAGE','IMAGE','VIDEO','VOICE',
    'AUDIO','MUSIC','CAPTIONS','EDIT','FINAL_VIDEO','THUMBNAIL'
  ));

ALTER TABLE v2_1.production_bibles
  ADD COLUMN IF NOT EXISTS contract_version integer,
  ADD COLUMN IF NOT EXISTS bible_id text,
  ADD COLUMN IF NOT EXISTS context_fingerprint text,
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS document jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS document_hash text,
  ADD COLUMN IF NOT EXISTS artifact_id uuid,
  ADD COLUMN IF NOT EXISTS source_script_artifact_id uuid,
  ADD COLUMN IF NOT EXISTS source_script_version integer,
  ADD COLUMN IF NOT EXISTS source_script_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_bibles_artifact_fk'
      AND connamespace = 'v2_1'::regnamespace
  ) THEN
    ALTER TABLE v2_1.production_bibles
      ADD CONSTRAINT production_bibles_artifact_fk
      FOREIGN KEY (artifact_id) REFERENCES v2_1.artifacts(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_bibles_source_script_fk'
      AND connamespace = 'v2_1'::regnamespace
  ) THEN
    ALTER TABLE v2_1.production_bibles
      ADD CONSTRAINT production_bibles_source_script_fk
      FOREIGN KEY (source_script_artifact_id) REFERENCES v2_1.artifacts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_production_bibles_bible_id
  ON v2_1.production_bibles(bible_id)
  WHERE bible_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_production_bibles_artifact
  ON v2_1.production_bibles(artifact_id)
  WHERE artifact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_production_bibles_context
  ON v2_1.production_bibles(production_id, context_fingerprint, version);

CREATE OR REPLACE FUNCTION v2_1.enforce_production_bible_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bible_artifact_type text;
  bible_artifact_production uuid;
  script_artifact_type text;
  script_artifact_production uuid;
BEGIN
  IF NEW.artifact_id IS NOT NULL THEN
    SELECT artifact_type, production_id
      INTO bible_artifact_type, bible_artifact_production
      FROM v2_1.artifacts
     WHERE id = NEW.artifact_id;

    IF bible_artifact_type IS DISTINCT FROM 'PRODUCTION_BIBLE' THEN
      RAISE EXCEPTION 'Production Bible artifact % must have artifact_type PRODUCTION_BIBLE', NEW.artifact_id;
    END IF;
    IF bible_artifact_production IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'Production Bible artifact % belongs to a different production', NEW.artifact_id;
    END IF;
  END IF;

  IF NEW.source_script_artifact_id IS NOT NULL THEN
    SELECT artifact_type, production_id
      INTO script_artifact_type, script_artifact_production
      FROM v2_1.artifacts
     WHERE id = NEW.source_script_artifact_id;

    IF script_artifact_type IS DISTINCT FROM 'SCRIPT' THEN
      RAISE EXCEPTION 'Production Bible source artifact % must have artifact_type SCRIPT', NEW.source_script_artifact_id;
    END IF;
    IF script_artifact_production IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'Production Bible source SCRIPT % belongs to a different production', NEW.source_script_artifact_id;
    END IF;
  END IF;

  IF NEW.document_hash IS NULL AND NEW.document IS DISTINCT FROM '{}'::jsonb THEN
    NEW.document_hash := encode(digest(NEW.document::text, 'sha256'), 'hex');
  ELSIF NEW.document_hash IS NOT NULL AND NEW.document IS DISTINCT FROM '{}'::jsonb THEN
    IF encode(digest(NEW.document::text, 'sha256'), 'hex') IS DISTINCT FROM NEW.document_hash THEN
      RAISE EXCEPTION 'Production Bible document_hash does not match document';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_bible_boundary ON v2_1.production_bibles;
CREATE TRIGGER trg_production_bible_boundary
BEFORE INSERT OR UPDATE ON v2_1.production_bibles
FOR EACH ROW
EXECUTE FUNCTION v2_1.enforce_production_bible_boundary();

CREATE OR REPLACE FUNCTION v2_1.prevent_production_bible_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Resolved production bibles are immutable; create a new version instead';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_bible_immutable ON v2_1.production_bibles;
CREATE TRIGGER trg_production_bible_immutable
BEFORE UPDATE ON v2_1.production_bibles
FOR EACH ROW
EXECUTE FUNCTION v2_1.prevent_production_bible_mutation();

COMMENT ON TABLE v2_1.production_bibles IS
  'Immutable, production-scoped canonical BIBLE. Each version is a durable creative/production specification with exact SCRIPT provenance.';
COMMENT ON FUNCTION v2_1.enforce_production_bible_boundary() IS
  'Database-enforced BIBLE ownership, artifact type, source SCRIPT ownership, and document hash boundary.';
COMMENT ON FUNCTION v2_1.prevent_production_bible_mutation() IS
  'Resolved BIBLE rows cannot be updated; deleting an entire production remains allowed for lifecycle cleanup.';
