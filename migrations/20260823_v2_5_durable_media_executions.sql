-- V2.5 durable per-asset provider boundary and reconciliation state.
-- Forward-only recovery: ambiguous provider calls are never reset to NOT_STARTED;
-- they must be reconciled by provider request id or by an immutable artifact.

BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_5;

CREATE TABLE IF NOT EXISTS v2_5.media_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  kind text NOT NULL,
  input_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  provider text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  worker_id text,
  provider_request_id text,
  provider_status text,
  artifact_id text,
  artifact_version integer,
  artifact_storage_key text,
  artifact_content_hash text,
  content_type text,
  duration_ms integer,
  media_probe jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  provider_boundary_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v25_media_execution_kind_check CHECK (kind IN ('image','video','voice','audio')),
  CONSTRAINT v25_media_execution_status_check CHECK (status IN (
    'NOT_STARTED','RUNNING','MAY_HAVE_STARTED','SUCCEEDED','RETRYABLE','FAILED','NEEDS_RECONCILIATION'
  )),
  CONSTRAINT v25_media_execution_artifact_check CHECK (
    status <> 'SUCCEEDED' OR (
      artifact_id IS NOT NULL AND artifact_version > 0 AND artifact_storage_key IS NOT NULL
      AND artifact_content_hash IS NOT NULL AND content_type IS NOT NULL
    )
  ),
  CONSTRAINT v25_media_execution_identity_unique UNIQUE (production_id, asset_id),
  CONSTRAINT v25_media_execution_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_v25_media_execution_reconciliation
  ON v2_5.media_executions(status, updated_at)
  WHERE status IN ('MAY_HAVE_STARTED','NEEDS_RECONCILIATION','RETRYABLE');

CREATE INDEX IF NOT EXISTS idx_v25_media_execution_brand
  ON v2_5.media_executions(workspace_id, brand_id, production_id, created_at);

CREATE OR REPLACE FUNCTION v2_5.enforce_media_execution_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE production_workspace uuid; production_brand uuid; brand_workspace uuid;
BEGIN
  SELECT workspace_id,brand_id INTO production_workspace,production_brand
  FROM v2_1.productions WHERE id=NEW.production_id;
  IF NOT FOUND OR production_workspace IS DISTINCT FROM NEW.workspace_id OR production_brand IS DISTINCT FROM NEW.brand_id THEN
    RAISE EXCEPTION 'Media execution ownership does not match production ownership';
  END IF;

  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF NOT FOUND OR brand_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Media execution workspace does not own canonical brand';
  END IF;

  IF TG_OP='UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
    NEW.production_id IS DISTINCT FROM OLD.production_id OR
    NEW.asset_id IS DISTINCT FROM OLD.asset_id OR
    NEW.kind IS DISTINCT FROM OLD.kind OR
    NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.provider IS DISTINCT FROM OLD.provider OR
    NEW.model IS DISTINCT FROM OLD.model
  ) THEN
    RAISE EXCEPTION 'Media execution identity is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_v25_media_execution_boundary ON v2_5.media_executions;
CREATE TRIGGER trg_v25_media_execution_boundary
BEFORE INSERT OR UPDATE ON v2_5.media_executions
FOR EACH ROW EXECUTE FUNCTION v2_5.enforce_media_execution_boundary();

COMMIT;
