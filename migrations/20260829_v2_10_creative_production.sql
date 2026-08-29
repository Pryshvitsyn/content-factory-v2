BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_10;

CREATE TABLE IF NOT EXISTS v2_10.creative_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  creative_schema_version text NOT NULL CHECK (creative_schema_version='2.10'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CREATIVE_INCOMPLETE','PREFLIGHT_READY','STARTING','STARTED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  creative_brief jsonb NOT NULL,
  creative_validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_approval jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_preflight jsonb,
  preflight_fingerprint text,
  production_id uuid REFERENCES v2_1.productions(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  start_claimed_at timestamptz,
  started_at timestamptz,
  CHECK ((status IN ('PREFLIGHT_READY','STARTING','STARTED')) = (preflight_fingerprint IS NOT NULL AND final_preflight IS NOT NULL)),
  CHECK ((status='STARTING') = (start_claimed_at IS NOT NULL AND started_at IS NULL) OR status='STARTED'),
  CHECK ((status='STARTED') = (production_id IS NOT NULL AND started_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS creative_drafts_scope ON v2_10.creative_drafts(workspace_id, brand_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_10.voice_preview_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id), preview_fingerprint text NOT NULL,
  provider text NOT NULL, model text NOT NULL, voice_id text NOT NULL, configuration jsonb NOT NULL,
  preview_text_hash text NOT NULL, storage_key text NOT NULL, content_hash text NOT NULL,
  content_type text NOT NULL, duration_seconds numeric NOT NULL CHECK (duration_seconds > 0),
  external_call_count integer NOT NULL CHECK (external_call_count IN (0,1)), provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, brand_id, preview_fingerprint)
);

CREATE TABLE IF NOT EXISTS v2_10.uploaded_voice_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id), version integer NOT NULL CHECK (version > 0),
  storage_key text NOT NULL, content_hash text NOT NULL, content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0), duration_seconds numeric NOT NULL CHECK (duration_seconds > 0),
  audio_metadata jsonb NOT NULL, operator_attestation jsonb NOT NULL, provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, brand_id, content_hash, version)
);

CREATE TABLE IF NOT EXISTS v2_10.preflight_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id), brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  draft_revision integer NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, draft_revision, fingerprint)
);

CREATE OR REPLACE FUNCTION v2_10.enforce_brand_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  SELECT workspace_id INTO owner FROM v2_2.brands WHERE id=NEW.brand_id;
  IF owner IS NULL OR owner <> NEW.workspace_id THEN RAISE EXCEPTION 'V2.10 brand/workspace ownership mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION v2_10.protect_creative_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='STARTED' THEN RAISE EXCEPTION 'started V2.10 creative draft is immutable'; END IF;
  IF OLD.status='STARTING' AND NEW.status<>'STARTED' THEN RAISE EXCEPTION 'claimed V2.10 creative draft may only become started'; END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.creative_schema_version IS DISTINCT FROM OLD.creative_schema_version THEN
    RAISE EXCEPTION 'V2.10 creative draft ownership and identity are immutable';
  END IF;
  IF NEW.creative_brief IS DISTINCT FROM OLD.creative_brief OR NEW.provider_selection IS DISTINCT FROM OLD.provider_selection
    OR NEW.voice_selection IS DISTINCT FROM OLD.voice_selection OR NEW.voice_approval IS DISTINCT FROM OLD.voice_approval THEN
    NEW.revision := OLD.revision + 1; NEW.final_preflight := NULL; NEW.preflight_fingerprint := NULL;
    IF NEW.status = 'PREFLIGHT_READY' THEN NEW.status := 'DRAFT'; END IF;
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION v2_10.reject_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'V2.10 evidence is immutable'; END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['creative_drafts','voice_preview_artifacts','uploaded_voice_artifacts','preflight_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_scope BEFORE INSERT OR UPDATE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.enforce_brand_workspace()', table_name, table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS creative_draft_protection ON v2_10.creative_drafts;
CREATE TRIGGER creative_draft_protection BEFORE UPDATE ON v2_10.creative_drafts FOR EACH ROW EXECUTE FUNCTION v2_10.protect_creative_draft();

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['voice_preview_artifacts','uploaded_voice_artifacts','preflight_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_update ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_update BEFORE UPDATE OR DELETE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.reject_evidence_change()', table_name, table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION v2_10.reject_started_draft_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status IN ('STARTING','STARTED') THEN RAISE EXCEPTION 'claimed or started V2.10 creative draft cannot be deleted'; END IF; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS creative_draft_no_started_delete ON v2_10.creative_drafts;
CREATE TRIGGER creative_draft_no_started_delete BEFORE DELETE ON v2_10.creative_drafts FOR EACH ROW EXECUTE FUNCTION v2_10.reject_started_draft_delete();

COMMIT;

-- Forward-only recovery: stop V2.10 routes to roll back behavior. Voice/preflight evidence
-- and started drafts are immutable and must not be deleted or rewritten.
