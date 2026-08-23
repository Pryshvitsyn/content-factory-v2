-- V2.4 canonical production ownership guard.
--
-- V2.4 tenant scope is public.workspaces and canonical brand identity is
-- v2_2.brands. Legacy V2.1 installations may also contain tenant, business
-- and project columns, but those identities cannot be inferred from a V2.2
-- brand. Preserve them when present; never manufacture values for them.

BEGIN;

CREATE OR REPLACE FUNCTION v2_1.enforce_production_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE canonical_workspace_id uuid; canonical_brand_status text;
BEGIN
  IF NEW.workspace_id IS NULL OR NEW.brand_id IS NULL THEN
    IF NEW.status IN ('RUNNING','COMPLETED') THEN
      RAISE EXCEPTION 'Production % cannot run without canonical workspace and brand ownership', NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT workspace_id,status INTO canonical_workspace_id,canonical_brand_status
  FROM v2_2.brands WHERE id=NEW.brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production brand % does not exist in v2_2.brands',NEW.brand_id;
  END IF;
  IF canonical_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Production workspace does not own canonical brand';
  END IF;
  IF NEW.status IN ('RUNNING','COMPLETED') AND canonical_brand_status<>'ACTIVE' THEN
    RAISE EXCEPTION 'Production cannot run for an inactive canonical brand';
  END IF;

  -- Preserve all legacy ownership/request identity fields after execution
  -- starts, without requiring those optional columns on a clean V2.1 schema.
  IF TG_OP='UPDATE'
     AND (OLD.status IN ('RUNNING','COMPLETED','FAILED','CANCELLED') OR OLD.started_at IS NOT NULL)
     AND (
       NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
       NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
       (to_jsonb(NEW)->'tenant_id') IS DISTINCT FROM (to_jsonb(OLD)->'tenant_id') OR
       (to_jsonb(NEW)->'business_id') IS DISTINCT FROM (to_jsonb(OLD)->'business_id') OR
       (to_jsonb(NEW)->'project_id') IS DISTINCT FROM (to_jsonb(OLD)->'project_id') OR
       (to_jsonb(NEW)->'request_hash') IS DISTINCT FROM (to_jsonb(OLD)->'request_hash') OR
       (to_jsonb(NEW)->'context_fingerprint') IS DISTINCT FROM (to_jsonb(OLD)->'context_fingerprint') OR
       (to_jsonb(NEW)->'context_version') IS DISTINCT FROM (to_jsonb(OLD)->'context_version') OR
       (to_jsonb(NEW)->'context_snapshot') IS DISTINCT FROM (to_jsonb(OLD)->'context_snapshot') OR
       (to_jsonb(NEW)->'request_snapshot') IS DISTINCT FROM (to_jsonb(OLD)->'request_snapshot')
     ) THEN
    RAISE EXCEPTION 'Production context and ownership are immutable after production starts';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_productions_boundary ON v2_1.productions;
CREATE TRIGGER trg_productions_boundary
BEFORE INSERT OR UPDATE ON v2_1.productions
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_production_boundary();

COMMIT;
