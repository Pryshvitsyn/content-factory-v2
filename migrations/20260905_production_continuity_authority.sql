CREATE SCHEMA IF NOT EXISTS workflow_authority;

CREATE TABLE IF NOT EXISTS workflow_authority.continuity_reference_pack_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  entity_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('REAL_PERSON','SYNTHETIC_CHARACTER','OBJECT_PRODUCT','ABSTRACT_VISUAL')),
  revision integer NOT NULL CHECK (revision > 0),
  fingerprint text NOT NULL,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  artifact_content_hash text NOT NULL,
  artifact_storage_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,owner_brand_id,entity_id,revision),
  UNIQUE(workspace_id,owner_brand_id,fingerprint)
);

CREATE TABLE IF NOT EXISTS workflow_authority.continuity_reference_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  consumer_brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  pack_id uuid NOT NULL REFERENCES workflow_authority.continuity_reference_pack_revisions(id),
  pack_fingerprint text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('GRANTED','REVOKED')),
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_brand_id <> consumer_brand_id)
);
CREATE INDEX IF NOT EXISTS continuity_reference_grant_effective
  ON workflow_authority.continuity_reference_grant_events(workspace_id,owner_brand_id,consumer_brand_id,pack_id,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION workflow_authority.reject_authority_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'workflow authority evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS continuity_pack_immutable ON workflow_authority.continuity_reference_pack_revisions;
CREATE TRIGGER continuity_pack_immutable BEFORE UPDATE OR DELETE ON workflow_authority.continuity_reference_pack_revisions
  FOR EACH ROW EXECUTE FUNCTION workflow_authority.reject_authority_mutation();
DROP TRIGGER IF EXISTS continuity_grant_immutable ON workflow_authority.continuity_reference_grant_events;
CREATE TRIGGER continuity_grant_immutable BEFORE UPDATE OR DELETE ON workflow_authority.continuity_reference_grant_events
  FOR EACH ROW EXECUTE FUNCTION workflow_authority.reject_authority_mutation();

CREATE OR REPLACE FUNCTION workflow_authority.assert_continuity_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_workspace uuid; consumer_workspace uuid; pack_row workflow_authority.continuity_reference_pack_revisions;
BEGIN
  SELECT workspace_id INTO owner_workspace FROM v2_2.brands WHERE id=NEW.owner_brand_id;
  SELECT workspace_id INTO consumer_workspace FROM v2_2.brands WHERE id=NEW.consumer_brand_id;
  SELECT * INTO pack_row FROM workflow_authority.continuity_reference_pack_revisions WHERE id=NEW.pack_id;
  IF owner_workspace IS DISTINCT FROM NEW.workspace_id OR consumer_workspace IS DISTINCT FROM NEW.workspace_id
    OR pack_row.workspace_id IS DISTINCT FROM NEW.workspace_id OR pack_row.owner_brand_id IS DISTINCT FROM NEW.owner_brand_id
    OR pack_row.fingerprint IS DISTINCT FROM NEW.pack_fingerprint THEN
    RAISE EXCEPTION 'continuity authority scope/fingerprint mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION workflow_authority.assert_pack_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM v2_2.brands WHERE id=NEW.owner_brand_id AND workspace_id=NEW.workspace_id) THEN
    RAISE EXCEPTION 'continuity pack ownership mismatch';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS continuity_pack_scope ON workflow_authority.continuity_reference_pack_revisions;
CREATE TRIGGER continuity_pack_scope BEFORE INSERT ON workflow_authority.continuity_reference_pack_revisions
  FOR EACH ROW EXECUTE FUNCTION workflow_authority.assert_pack_scope();
DROP TRIGGER IF EXISTS continuity_grant_scope ON workflow_authority.continuity_reference_grant_events;
CREATE TRIGGER continuity_grant_scope BEFORE INSERT ON workflow_authority.continuity_reference_grant_events
  FOR EACH ROW EXECUTE FUNCTION workflow_authority.assert_continuity_scope();
