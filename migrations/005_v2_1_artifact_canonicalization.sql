BEGIN;

-- V2.1 canonical artifact contract.
-- artifact_versions is the single source of truth for version history.
-- artifacts.version remains temporarily as a compatibility mirror for
-- legacy consumers; it is not an independent version counter.

ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS content_json jsonb,
  ADD COLUMN IF NOT EXISTS content_text text,
  ADD COLUMN IF NOT EXISTS uri text,
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_size bigint,
  ADD COLUMN IF NOT EXISTS content_type text;

UPDATE artifact_versions av
SET content_json = a.content_json,
    content_text = a.content_text,
    uri = a.uri,
    provider_id = a.provider_id,
    model_id = a.model_id,
    metadata = a.metadata,
    content_size = CASE
      WHEN a.metadata ? 'size' AND (a.metadata->>'size') ~ '^[0-9]+$'
        THEN (a.metadata->>'size')::bigint
      ELSE NULL
    END,
    content_type = NULLIF(a.metadata->>'contentType', '')
FROM artifacts a
WHERE a.id = av.artifact_id
  AND av.version = a.version;

CREATE OR REPLACE FUNCTION sync_artifact_latest_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE artifacts a
  SET version = latest.version,
      sha256 = latest.sha256,
      content_json = latest.content_json,
      content_text = latest.content_text,
      uri = latest.uri,
      provider_id = latest.provider_id,
      model_id = latest.model_id,
      metadata = latest.metadata
  FROM (
    SELECT av.*
    FROM artifact_versions av
    WHERE av.artifact_id = NEW.artifact_id
    ORDER BY av.version DESC
    LIMIT 1
  ) latest
  WHERE a.id = NEW.artifact_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_artifact_latest_version ON artifact_versions;
CREATE TRIGGER trg_sync_artifact_latest_version
AFTER INSERT OR UPDATE OF version, sha256, content_json, content_text, uri,
  provider_id, model_id, metadata ON artifact_versions
FOR EACH ROW EXECUTE FUNCTION sync_artifact_latest_version();

COMMENT ON COLUMN artifacts.version IS
  'Deprecated V2.1 compatibility mirror. Canonical version history lives in artifact_versions.';
COMMENT ON TABLE artifact_versions IS
  'Canonical immutable artifact version history for V2.1.';

COMMIT;
