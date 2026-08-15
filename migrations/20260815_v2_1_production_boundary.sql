-- V2.1 production boundary
-- Database-enforced idempotency, immutable context snapshots, ownership isolation,
-- and auditability. This is the handoff from resolved context to executable production.

CREATE TABLE IF NOT EXISTS v2_1.production_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES v2_1.tenants(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES v2_1.businesses(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES v2_1.projects(id) ON DELETE RESTRICT,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_hash)
);

ALTER TABLE v2_1.projects
  ADD CONSTRAINT projects_id_tenant_business_key UNIQUE (id, tenant_id, business_id);

ALTER TABLE v2_1.productions
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS business_id uuid,
  ADD COLUMN IF NOT EXISTS brand_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS context_fingerprint text,
  ADD COLUMN IF NOT EXISTS context_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE v2_1.productions
  ADD CONSTRAINT productions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES v2_1.tenants(id) ON DELETE RESTRICT;

ALTER TABLE v2_1.productions
  ADD CONSTRAINT productions_business_fk
  FOREIGN KEY (business_id) REFERENCES v2_1.businesses(id) ON DELETE RESTRICT;

ALTER TABLE v2_1.productions
  ADD CONSTRAINT productions_brand_fk
  FOREIGN KEY (brand_id) REFERENCES v2_1.brands(id) ON DELETE RESTRICT;

ALTER TABLE v2_1.productions
  ADD CONSTRAINT productions_project_fk
  FOREIGN KEY (project_id) REFERENCES v2_1.projects(id) ON DELETE RESTRICT;

ALTER TABLE v2_1.productions
  ADD CONSTRAINT productions_project_owner_fk
  FOREIGN KEY (project_id, tenant_id, business_id)
  REFERENCES v2_1.projects(id, tenant_id, business_id) ON DELETE RESTRICT;

ALTER TABLE v2_1.production_requests
  ADD CONSTRAINT production_requests_project_owner_fk
  FOREIGN KEY (project_id, tenant_id, business_id)
  REFERENCES v2_1.projects(id, tenant_id, business_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_productions_request
  ON v2_1.productions(tenant_id, request_hash)
  WHERE request_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_production_requests_project
  ON v2_1.production_requests(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_v21_productions_context
  ON v2_1.productions(tenant_id, business_id, context_fingerprint);

-- Cross-object ownership is enforced at the production boundary. The trigger is
-- deliberately fail-closed: a production without a complete ownership chain cannot start.
CREATE OR REPLACE FUNCTION v2_1.enforce_production_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_row record;
  brand_business uuid;
  business_tenant uuid;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.business_id IS NULL OR NEW.brand_id IS NULL OR NEW.project_id IS NULL THEN
    IF NEW.status IN ('RUNNING','COMPLETED') THEN
      RAISE EXCEPTION 'Production % cannot run without tenant, business, brand and project ownership', NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT id, tenant_id, business_id INTO project_row
  FROM v2_1.projects WHERE id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production project % does not exist', NEW.project_id;
  END IF;

  IF project_row.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR project_row.business_id IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'Production ownership does not match project ownership';
  END IF;

  SELECT tenant_id INTO business_tenant
  FROM v2_1.businesses WHERE id = NEW.business_id;

  IF business_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Production business does not belong to production tenant';
  END IF;

  SELECT business_id INTO brand_business
  FROM v2_1.brands WHERE id = NEW.brand_id;

  IF brand_business IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'Production brand does not belong to production business';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.status IN ('RUNNING','COMPLETED','FAILED','CANCELLED')
          OR OLD.started_at IS NOT NULL)
     AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.business_id IS DISTINCT FROM OLD.business_id OR
       NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
       NEW.project_id IS DISTINCT FROM OLD.project_id OR
       NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
       NEW.context_fingerprint IS DISTINCT FROM OLD.context_fingerprint OR
       NEW.context_version IS DISTINCT FROM OLD.context_version OR
       NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot OR
       NEW.request_snapshot IS DISTINCT FROM OLD.request_snapshot
     ) THEN
    RAISE EXCEPTION 'Production context and request identity are immutable after production starts';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productions_boundary ON v2_1.productions;
CREATE TRIGGER trg_productions_boundary
BEFORE INSERT OR UPDATE ON v2_1.productions
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_production_boundary();

CREATE OR REPLACE FUNCTION v2_1.prevent_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
     OR NEW.request_snapshot IS DISTINCT FROM OLD.request_snapshot
     OR NEW.context_fingerprint IS DISTINCT FROM OLD.context_fingerprint
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
    RAISE EXCEPTION 'Production audit snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productions_snapshot_immutable ON v2_1.productions;
CREATE TRIGGER trg_productions_snapshot_immutable
BEFORE UPDATE ON v2_1.productions
FOR EACH ROW EXECUTE FUNCTION v2_1.prevent_snapshot_mutation();

-- Audit events are append-only. Existing events remain the canonical event ledger.
CREATE OR REPLACE FUNCTION v2_1.audit_production_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO v2_1.events(event_type, entity_type, entity_id, payload)
  VALUES (
    CASE WHEN TG_OP = 'INSERT' THEN 'PRODUCTION_CREATED' ELSE 'PRODUCTION_UPDATED' END,
    'production', NEW.id,
    jsonb_build_object(
      'operation', TG_OP,
      'status', NEW.status,
      'tenant_id', NEW.tenant_id,
      'business_id', NEW.business_id,
      'brand_id', NEW.brand_id,
      'project_id', NEW.project_id,
      'request_hash', NEW.request_hash,
      'context_fingerprint', NEW.context_fingerprint,
      'context_version', NEW.context_version,
      'recorded_at', now()
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productions_audit ON v2_1.productions;
CREATE TRIGGER trg_productions_audit
AFTER INSERT OR UPDATE ON v2_1.productions
FOR EACH ROW EXECUTE FUNCTION v2_1.audit_production_change();

COMMENT ON TABLE v2_1.production_requests IS 'Durable production intent; tenant-scoped request_hash prevents duplicate production intent.';
COMMENT ON COLUMN v2_1.productions.context_snapshot IS 'Immutable resolved creative/business context captured at production creation.';
COMMENT ON COLUMN v2_1.productions.request_snapshot IS 'Immutable normalized production request captured at production creation.';
COMMENT ON COLUMN v2_1.productions.context_fingerprint IS 'Deterministic identity of the resolved context used by this production.';
COMMENT ON COLUMN v2_1.productions.request_hash IS 'Deterministic idempotency identity for the production request.';
