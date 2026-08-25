BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_8;

CREATE TABLE IF NOT EXISTS v2_8.provider_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL CHECK (provider IN ('replicate','fal')),
  vendor text NOT NULL,
  model_id text NOT NULL,
  display_name text NOT NULL,
  adapter_family text NOT NULL CHECK (adapter_family IN ('replicate-video','fal-video')),
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities)='array'),
  profile_preset text NOT NULL CHECK (profile_preset IN ('VIDEO_STANDARD','VIDEO_T2V_I2V')),
  enabled boolean NOT NULL DEFAULT true,
  experimental boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,provider,model_id)
);

CREATE INDEX IF NOT EXISTS provider_models_workspace_provider_idx
  ON v2_8.provider_models(workspace_id,provider) WHERE enabled=true;

CREATE OR REPLACE FUNCTION v2_8.enforce_provider_model_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.provider IS DISTINCT FROM OLD.provider OR
    NEW.vendor IS DISTINCT FROM OLD.vendor OR NEW.model_id IS DISTINCT FROM OLD.model_id OR
    NEW.adapter_family IS DISTINCT FROM OLD.adapter_family OR NEW.capabilities IS DISTINCT FROM OLD.capabilities OR
    NEW.profile_preset IS DISTINCT FROM OLD.profile_preset OR NEW.experimental IS DISTINCT FROM OLD.experimental
  ) THEN RAISE EXCEPTION 'provider model routing identity is immutable'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_model_identity ON v2_8.provider_models;
CREATE TRIGGER provider_model_identity BEFORE UPDATE ON v2_8.provider_models
FOR EACH ROW EXECUTE FUNCTION v2_8.enforce_provider_model_identity();

ALTER TABLE v2_5.media_executions ADD COLUMN IF NOT EXISTS vendor text;
ALTER TABLE v2_5.media_executions ADD COLUMN IF NOT EXISTS model_version text;
ALTER TABLE v2_5.media_executions ADD COLUMN IF NOT EXISTS profile text;
ALTER TABLE v2_5.media_executions ADD COLUMN IF NOT EXISTS capability text;
ALTER TABLE v2_5.media_executions ADD COLUMN IF NOT EXISTS resolved_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

-- Forward-only recovery: disable V2.8 catalog routes/adapters. Do not drop catalog rows,
-- immutable production provenance, media executions, or generated artifacts.
