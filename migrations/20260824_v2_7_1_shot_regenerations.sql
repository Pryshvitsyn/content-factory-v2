BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_7;

CREATE TABLE IF NOT EXISTS v2_7.shot_regenerations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id),
  request_id uuid NOT NULL,
  shot_id text NOT NULL,
  source_asset_id text NOT NULL,
  replacement_asset_id text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL CHECK (status IN ('PREPARED','RUNNING','SUCCEEDED','RETRYING','FAILED','NEEDS_RECONCILIATION')),
  input_fingerprint text NOT NULL,
  canonical_raw_input jsonb NOT NULL,
  instruction text,
  expected_provider_calls integer NOT NULL DEFAULT 1 CHECK (expected_provider_calls = 1),
  provider text NOT NULL,
  model text NOT NULL,
  resolution text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  worker_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, request_id),
  UNIQUE (production_id, replacement_asset_id),
  UNIQUE (production_id, shot_id, revision_no)
);

CREATE INDEX IF NOT EXISTS shot_regenerations_current_idx
  ON v2_7.shot_regenerations(production_id, shot_id, revision_no DESC)
  WHERE status='SUCCEEDED';

CREATE UNIQUE INDEX IF NOT EXISTS shot_regenerations_one_active_idx
  ON v2_7.shot_regenerations(production_id)
  WHERE status IN ('PREPARED','RUNNING','RETRYING','NEEDS_RECONCILIATION');

CREATE OR REPLACE FUNCTION v2_7.enforce_shot_regeneration_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE production_workspace uuid; production_brand uuid; brand_workspace uuid;
BEGIN
  SELECT workspace_id, brand_id INTO production_workspace, production_brand
  FROM v2_1.productions WHERE id=NEW.production_id;
  IF production_workspace IS NULL OR production_workspace <> NEW.workspace_id OR production_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'shot regeneration ownership mismatch';
  END IF;
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF brand_workspace IS NULL OR brand_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'shot regeneration brand ownership mismatch';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
    NEW.production_id IS DISTINCT FROM OLD.production_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR
    NEW.shot_id IS DISTINCT FROM OLD.shot_id OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id OR
    NEW.replacement_asset_id IS DISTINCT FROM OLD.replacement_asset_id OR NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint OR NEW.canonical_raw_input IS DISTINCT FROM OLD.canonical_raw_input OR
    NEW.provider IS DISTINCT FROM OLD.provider OR NEW.model IS DISTINCT FROM OLD.model OR NEW.resolution IS DISTINCT FROM OLD.resolution
  ) THEN RAISE EXCEPTION 'shot regeneration identity is immutable'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shot_regeneration_ownership ON v2_7.shot_regenerations;
CREATE TRIGGER shot_regeneration_ownership BEFORE INSERT OR UPDATE
ON v2_7.shot_regenerations FOR EACH ROW EXECUTE FUNCTION v2_7.enforce_shot_regeneration_ownership();

COMMIT;

-- Forward-only recovery: records are immutable production provenance. A rollback disables
-- V2.7.1 routes; it must not drop successful revision history or generated artifacts.
