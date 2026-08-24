-- V2.6 durable FAST renderer boundary and recovery state.
-- Forward-only recovery: an execution that may have reached the renderer is
-- never reset. Recover it by renderer_task_id or reconcile it manually.

BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_6;

CREATE TABLE IF NOT EXISTS v2_6.fast_render_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  render_mode text NOT NULL DEFAULT 'FAST',
  renderer text NOT NULL,
  renderer_version text,
  input_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  worker_id text,
  renderer_task_id text,
  renderer_status text,
  artifact_id text,
  artifact_version integer,
  artifact_storage_key text,
  artifact_content_hash text,
  content_type text,
  duration_ms integer,
  media_probe jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost jsonb NOT NULL DEFAULT '{"status":"unknown"}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  renderer_boundary_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v26_fast_render_mode_check CHECK (render_mode='FAST'),
  CONSTRAINT v26_fast_render_status_check CHECK (status IN (
    'NOT_STARTED','RUNNING','MAY_HAVE_STARTED','REQUEST_ACCEPTED','PROCESSING',
    'SUCCEEDED','RETRYABLE','NEEDS_RECONCILIATION','VALIDATION_FAILED','FAILED'
  )),
  CONSTRAINT v26_fast_render_artifact_check CHECK (
    status <> 'SUCCEEDED' OR (
      artifact_id IS NOT NULL AND artifact_version > 0 AND artifact_storage_key IS NOT NULL
      AND artifact_content_hash IS NOT NULL AND content_type IS NOT NULL
    )
  ),
  CONSTRAINT v26_fast_render_identity_unique UNIQUE (production_id, render_mode, renderer),
  CONSTRAINT v26_fast_render_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_v26_fast_render_recovery
  ON v2_6.fast_render_executions(status, updated_at)
  WHERE status IN ('MAY_HAVE_STARTED','REQUEST_ACCEPTED','PROCESSING','NEEDS_RECONCILIATION','RETRYABLE');

CREATE INDEX IF NOT EXISTS idx_v26_fast_render_scope
  ON v2_6.fast_render_executions(workspace_id, brand_id, production_id, created_at);

CREATE OR REPLACE FUNCTION v2_6.enforce_fast_render_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE production_workspace uuid; production_brand uuid; brand_workspace uuid;
BEGIN
  SELECT workspace_id,brand_id INTO production_workspace,production_brand
  FROM v2_1.productions WHERE id=NEW.production_id;
  IF NOT FOUND OR production_workspace IS DISTINCT FROM NEW.workspace_id OR production_brand IS DISTINCT FROM NEW.brand_id THEN
    RAISE EXCEPTION 'FAST render ownership does not match production ownership';
  END IF;

  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF NOT FOUND OR brand_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'FAST render workspace does not own canonical brand';
  END IF;

  IF TG_OP='UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.brand_id IS DISTINCT FROM OLD.brand_id OR
    NEW.production_id IS DISTINCT FROM OLD.production_id OR
    NEW.render_mode IS DISTINCT FROM OLD.render_mode OR
    NEW.renderer IS DISTINCT FROM OLD.renderer OR
    NEW.renderer_version IS DISTINCT FROM OLD.renderer_version OR
    NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  ) THEN
    RAISE EXCEPTION 'FAST render execution identity is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_v26_fast_render_boundary ON v2_6.fast_render_executions;
CREATE TRIGGER trg_v26_fast_render_boundary
BEFORE INSERT OR UPDATE ON v2_6.fast_render_executions
FOR EACH ROW EXECUTE FUNCTION v2_6.enforce_fast_render_boundary();

COMMIT;
