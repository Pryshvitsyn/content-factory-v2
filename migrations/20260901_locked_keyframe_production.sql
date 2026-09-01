BEGIN;

CREATE TABLE IF NOT EXISTS v2_10.locked_keyframe_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL UNIQUE,
  opening_shot_id text NOT NULL,
  opening_asset_id text NOT NULL,
  canonical_intent_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'PREPARED' CHECK (state IN (
    'PREPARED','KEYFRAME_READY','AWAITING_HUMAN_APPROVAL','KEYFRAME_APPROVED',
    'FIRST_VIDEO_RUNNING','FIRST_VIDEO_FAILED','FIRST_VIDEO_ACCEPTED','CONTINUATION_STARTED'
  )),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, opening_shot_id)
);

CREATE TABLE IF NOT EXISTS v2_10.keyframe_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES v2_10.locked_keyframe_workflows(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL,
  shot_id text NOT NULL,
  asset_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  predecessor_id uuid REFERENCES v2_10.keyframe_artifacts(id),
  source_type text NOT NULL CHECK (source_type IN ('AI_GENERATED','OPERATOR_UPLOAD')),
  provider text NOT NULL,
  model text NOT NULL,
  generation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_fingerprint text NOT NULL,
  storage_key text NOT NULL,
  content_hash text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  provider_request_id text,
  provenance jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, asset_id, version),
  UNIQUE(workflow_id, storage_key),
  UNIQUE(workflow_id, content_hash, version)
);

CREATE TABLE IF NOT EXISTS v2_10.keyframe_validation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyframe_id uuid NOT NULL REFERENCES v2_10.keyframe_artifacts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  shot_plan_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS','WARN','FAIL')),
  result jsonb NOT NULL,
  semantic_external_calls integer NOT NULL CHECK (semantic_external_calls IN (0,1)),
  evaluator_provider text,
  evaluator_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(keyframe_id, shot_plan_fingerprint)
);

CREATE TABLE IF NOT EXISTS v2_10.keyframe_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyframe_id uuid NOT NULL REFERENCES v2_10.keyframe_artifacts(id),
  validation_event_id uuid NOT NULL REFERENCES v2_10.keyframe_validation_events(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  actor text NOT NULL,
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(keyframe_id)
);

CREATE TABLE IF NOT EXISTS v2_10.locked_stage_preflights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES v2_10.locked_keyframe_workflows(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  stage text NOT NULL CHECK (stage IN ('KEYFRAME','FIRST_VIDEO')),
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  keyframe_id uuid REFERENCES v2_10.keyframe_artifacts(id),
  keyframe_version integer,
  keyframe_content_hash text,
  fingerprint text NOT NULL,
  execution_plan jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, stage, fingerprint)
);

CREATE TABLE IF NOT EXISTS v2_10.locked_stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES v2_10.locked_keyframe_workflows(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  stage text NOT NULL CHECK (stage IN ('KEYFRAME','FIRST_VIDEO')),
  preflight_id uuid NOT NULL REFERENCES v2_10.locked_stage_preflights(id),
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','NEEDS_RECONCILIATION')),
  boundary_state text NOT NULL CHECK (boundary_state IN ('NOT_CROSSED','MAY_HAVE_STARTED','COMPLETED')),
  provider_request_id text,
  keyframe_id uuid REFERENCES v2_10.keyframe_artifacts(id),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(workflow_id, stage, preflight_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS locked_stage_one_active_attempt
  ON v2_10.locked_stage_attempts(workflow_id, stage)
  WHERE status IN ('RUNNING','NEEDS_RECONCILIATION');

CREATE INDEX IF NOT EXISTS keyframe_artifacts_lineage
  ON v2_10.keyframe_artifacts(workflow_id, asset_id, version DESC);

CREATE OR REPLACE FUNCTION v2_10.protect_locked_keyframe_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'locked-keyframe evidence is immutable'; END $$;

CREATE OR REPLACE FUNCTION v2_10.protect_locked_keyframe_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.production_id IS DISTINCT FROM OLD.production_id
    OR NEW.opening_shot_id IS DISTINCT FROM OLD.opening_shot_id OR NEW.opening_asset_id IS DISTINCT FROM OLD.opening_asset_id
    OR NEW.canonical_intent_fingerprint IS DISTINCT FROM OLD.canonical_intent_fingerprint
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'locked-keyframe workflow identity is immutable';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state='PREPARED' AND NEW.state='KEYFRAME_READY') OR
    (OLD.state='KEYFRAME_READY' AND NEW.state='AWAITING_HUMAN_APPROVAL') OR
    (OLD.state='AWAITING_HUMAN_APPROVAL' AND NEW.state IN ('KEYFRAME_READY','KEYFRAME_APPROVED')) OR
    (OLD.state='KEYFRAME_APPROVED' AND NEW.state IN ('KEYFRAME_READY','FIRST_VIDEO_RUNNING','FIRST_VIDEO_FAILED','FIRST_VIDEO_ACCEPTED')) OR
    (OLD.state='FIRST_VIDEO_RUNNING' AND NEW.state IN ('FIRST_VIDEO_FAILED','FIRST_VIDEO_ACCEPTED')) OR
    (OLD.state='FIRST_VIDEO_FAILED' AND NEW.state='KEYFRAME_READY') OR
    (OLD.state='FIRST_VIDEO_ACCEPTED' AND NEW.state='CONTINUATION_STARTED')
  ) THEN RAISE EXCEPTION 'invalid locked-keyframe workflow state transition: % -> %', OLD.state, NEW.state; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION v2_10.protect_locked_stage_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'locked-keyframe stage attempt evidence is immutable'; END IF;
  IF OLD.status<>'RUNNING' THEN RAISE EXCEPTION 'terminal locked-keyframe stage attempt evidence is immutable'; END IF;
  IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.stage IS DISTINCT FROM OLD.stage
    OR NEW.preflight_id IS DISTINCT FROM OLD.preflight_id OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'locked-keyframe stage attempt identity is immutable';
  END IF;
  IF NEW.status='RUNNING' THEN
    IF NEW.result IS DISTINCT FROM OLD.result OR NEW.error IS DISTINCT FROM OLD.error
      OR NEW.keyframe_id IS DISTINCT FROM OLD.keyframe_id OR NEW.completed_at IS NOT NULL
      OR NOT ((OLD.boundary_state='NOT_CROSSED' AND NEW.boundary_state IN ('NOT_CROSSED','MAY_HAVE_STARTED'))
        OR (OLD.boundary_state='MAY_HAVE_STARTED' AND NEW.boundary_state='MAY_HAVE_STARTED')) THEN
      RAISE EXCEPTION 'running locked-keyframe attempt may only record its paid boundary or provider request';
    END IF;
  ELSE
    IF NEW.completed_at IS NULL OR NEW.boundary_state NOT IN ('NOT_CROSSED','MAY_HAVE_STARTED','COMPLETED') THEN
      RAISE EXCEPTION 'terminal locked-keyframe attempt requires completion evidence';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['locked_keyframe_workflows','keyframe_artifacts','keyframe_validation_events',
    'keyframe_approval_events','locked_stage_preflights','locked_stage_attempts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_scope BEFORE INSERT OR UPDATE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.enforce_brand_workspace()', table_name, table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS locked_keyframe_workflow_protection ON v2_10.locked_keyframe_workflows;
CREATE TRIGGER locked_keyframe_workflow_protection BEFORE UPDATE ON v2_10.locked_keyframe_workflows
  FOR EACH ROW EXECUTE FUNCTION v2_10.protect_locked_keyframe_workflow();

DROP TRIGGER IF EXISTS locked_stage_attempt_protection ON v2_10.locked_stage_attempts;
CREATE TRIGGER locked_stage_attempt_protection BEFORE UPDATE OR DELETE ON v2_10.locked_stage_attempts
  FOR EACH ROW EXECUTE FUNCTION v2_10.protect_locked_stage_attempt();

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['keyframe_artifacts','keyframe_validation_events','keyframe_approval_events','locked_stage_preflights'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.protect_locked_keyframe_evidence()', table_name, table_name);
  END LOOP;
END $$;

COMMIT;

-- Forward-only recovery: disable locked-keyframe routes. Immutable artifact,
-- validation, approval and preflight evidence must be retained for audit.
