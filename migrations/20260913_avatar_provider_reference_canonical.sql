-- Additive operational references only: no source certification or truth membership changes.
-- Forward-only recovery: retain immutable rows; fix policy in a new version and regenerate.
CREATE TABLE IF NOT EXISTS avatar_studio.provider_reference_canonicals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL REFERENCES avatar_studio.characters(id),
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  route_id text NOT NULL,
  task_profile_id text NOT NULL,
  source_intake_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id),
  source_asset_id text NOT NULL,
  source_artifact_version integer NOT NULL,
  source_content_hash text NOT NULL CHECK(source_content_hash ~ '^[a-f0-9]{64}$'),
  canonical_artifact_id text NOT NULL,
  canonical_artifact_version integer NOT NULL,
  canonical_artifact_storage_key text NOT NULL,
  canonical_content_hash text NOT NULL CHECK(canonical_content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL,
  width integer NOT NULL CHECK(width > 0),
  height integer NOT NULL CHECK(height > 0),
  transform_policy_version text NOT NULL,
  transform jsonb NOT NULL,
  subject_resolution jsonb NOT NULL,
  diagnosis_before jsonb NOT NULL,
  qa_after jsonb NOT NULL CHECK(qa_after->>'status'='PASS'),
  canonical_fingerprint text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_reference_canonical_source_idx
  ON avatar_studio.provider_reference_canonicals(source_intake_id,route_id,created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='provider_reference_canonicals_immutable_change' AND tgrelid='avatar_studio.provider_reference_canonicals'::regclass) THEN
    CREATE TRIGGER provider_reference_canonicals_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.provider_reference_canonicals FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION avatar_studio.check_provider_reference_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM avatar_studio.asset_intakes s
    JOIN avatar_studio.character_versions v ON v.id=NEW.identity_version_id AND v.character_id=s.character_id AND v.workspace_id=s.workspace_id
    WHERE s.id=NEW.source_intake_id AND s.workspace_id=NEW.workspace_id AND s.brand_id=NEW.brand_id AND s.character_id=NEW.character_id
      AND s.content_hash=NEW.source_content_hash AND s.artifact_id::text=NEW.source_asset_id AND s.artifact_version=NEW.source_artifact_version) THEN
    RAISE EXCEPTION 'provider reference source scope/hash mismatch';
  END IF;
  IF (NEW.transform->>'anisotropicStretch') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'provider reference must preserve proportions'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='provider_reference_source_scope' AND tgrelid='avatar_studio.provider_reference_canonicals'::regclass) THEN
    CREATE TRIGGER provider_reference_source_scope BEFORE INSERT ON avatar_studio.provider_reference_canonicals FOR EACH ROW EXECUTE FUNCTION avatar_studio.check_provider_reference_source();
  END IF;
END $$;
