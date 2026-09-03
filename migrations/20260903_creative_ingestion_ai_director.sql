BEGIN;

CREATE TABLE IF NOT EXISTS v2_10.creative_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  mode text NOT NULL CHECK (mode IN ('DESCRIBE_IT','UPLOAD_REFERENCES','IMPORT_SPEC','REGISTERED_RENDERER','MANUAL_SETUP')),
  normalized_brief jsonb NOT NULL, source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v2_10.creative_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid REFERENCES v2_10.creative_drafts(id), workspace_id uuid NOT NULL REFERENCES workspaces(id), brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  original_filename text NOT NULL, media_type text NOT NULL, content_hash text NOT NULL, storage_key text NOT NULL, reference_role text NOT NULL,
  target_shot_id text, operator_note text, uploaded_by text NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, brand_id, content_hash, storage_key)
);
CREATE INDEX IF NOT EXISTS creative_references_scope ON v2_10.creative_references(workspace_id, brand_id, draft_id);
CREATE OR REPLACE FUNCTION v2_10.protect_creative_ingestion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'creative ingestion evidence is immutable'; END $$;
DROP TRIGGER IF EXISTS creative_ingestions_immutable ON v2_10.creative_ingestions;
CREATE TRIGGER creative_ingestions_immutable BEFORE UPDATE OR DELETE ON v2_10.creative_ingestions FOR EACH ROW EXECUTE FUNCTION v2_10.protect_creative_ingestion_evidence();
DROP TRIGGER IF EXISTS creative_references_immutable ON v2_10.creative_references;
CREATE TRIGGER creative_references_immutable BEFORE UPDATE OR DELETE ON v2_10.creative_references FOR EACH ROW EXECUTE FUNCTION v2_10.protect_creative_ingestion_evidence();
COMMIT;

-- Forward-only recovery: disable ingestion routes. Immutable references and source provenance remain auditable.
