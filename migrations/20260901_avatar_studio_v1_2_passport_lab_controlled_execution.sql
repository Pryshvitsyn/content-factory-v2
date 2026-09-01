-- Avatar Studio V1.2.1: controlled, approved Passport provider execution.
-- Forward-only recovery: disable execution routes. Retain every immutable
-- preflight, approval, lifecycle event, provider attempt and generated result.
BEGIN;

ALTER TABLE avatar_studio.asset_intakes DROP CONSTRAINT IF EXISTS asset_intakes_source_type_check;
ALTER TABLE avatar_studio.asset_intakes ADD CONSTRAINT asset_intakes_source_type_check CHECK
  (source_type IN ('UPLOAD','CAMERA','MICROPHONE','EXISTING_ASSET','SAFE_URL_IMPORT','PROVIDER_OUTPUT'));

CREATE TABLE IF NOT EXISTS avatar_studio.passport_generation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
  generation_spec_id uuid NOT NULL REFERENCES avatar_studio.passport_generation_specs(id),
  provider text NOT NULL,
  model text NOT NULL,
  adapter_family text NOT NULL,
  capability text NOT NULL,
  profile text NOT NULL,
  candidate_count integer NOT NULL,
  calls_per_candidate integer NOT NULL,
  total_planned_calls integer NOT NULL,
  cost_plan jsonb NOT NULL,
  maximum_allowed_cost numeric(14,6) NOT NULL,
  input_snapshot jsonb NOT NULL,
  preflight_fingerprint text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (candidate_count > 0),
  CHECK (calls_per_candidate > 0),
  CHECK (total_planned_calls = candidate_count * calls_per_candidate),
  CHECK (maximum_allowed_cost >= 0),
  CHECK (capability='MULTI_VIEW_IDENTITY_REFERENCE')
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES avatar_studio.passport_generation_executions(id),
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (status IN ('PLANNED','PREFLIGHT_READY','AWAITING_APPROVAL','APPROVED','QUEUED','GENERATING',
    'PARTIAL_SUCCESS','GENERATED','FAILED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_execution_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  vertical_code text NOT NULL,
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL,
  identity_lock_version_id uuid NOT NULL,
  generation_spec_id uuid NOT NULL,
  execution_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.passport_generation_executions(id),
  provider text NOT NULL,
  model text NOT NULL,
  candidate_count integer NOT NULL,
  call_count integer NOT NULL,
  known_total_cost numeric(14,6),
  unknown_cost_acknowledged boolean NOT NULL,
  maximum_allowed_cost numeric(14,6) NOT NULL,
  input_asset_versions jsonb NOT NULL,
  prompt_version text NOT NULL,
  spec_version text NOT NULL,
  preflight_fingerprint text NOT NULL,
  exact_proposal jsonb NOT NULL,
  explicit_confirmation boolean NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (explicit_confirmation=true),
  CHECK (maximum_allowed_cost>=0),
  CHECK (known_total_cost IS NULL OR known_total_cost<=maximum_allowed_cost)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_provider_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES avatar_studio.passport_generation_executions(id),
  candidate_ordinal integer NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  adapter_family text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  planned_cost numeric(14,6),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(execution_id,candidate_ordinal),
  UNIQUE(idempotency_key),
  CHECK (candidate_ordinal>0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_provider_attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  attempt_id uuid NOT NULL REFERENCES avatar_studio.passport_provider_attempts(id),
  status text NOT NULL,
  provider_request_id text,
  failure_classification text,
  safe_error_message text,
  may_have_spent boolean NOT NULL DEFAULT false,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual_known_cost numeric(14,6),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (status IN ('QUEUED','STARTED','SUCCEEDED','FAILED','CANCELLED')),
  CHECK (failure_classification IS NULL OR failure_classification IN
    ('PROVIDER_CONFIGURATION','PROVIDER_AUTH','PROVIDER_CAPABILITY','PROVIDER_TIMEOUT','PROVIDER_RATE_LIMIT',
     'PROVIDER_REJECTED_INPUT','PROVIDER_OUTPUT_INVALID','ARTIFACT_INGEST_FAILED','SECURITY_REJECTED_OUTPUT',
     'COST_CHANGED','BUDGET_EXCEEDED','CONSENT_INVALIDATED','GATE0_INVALIDATED','UNKNOWN')),
  CHECK (actual_known_cost IS NULL OR actual_known_cost>=0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_execution_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  vertical_code text NOT NULL,
  character_id uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES avatar_studio.passport_generation_executions(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.passport_provider_attempts(id),
  candidate_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.passport_candidates(id),
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  content_hash text NOT NULL,
  storage_key text NOT NULL,
  provider_request_id text,
  actual_known_cost numeric(14,6),
  provenance jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (artifact_version>0),
  CHECK (actual_known_cost IS NULL OR actual_known_cost>=0)
);

CREATE INDEX IF NOT EXISTS idx_avatar_passport_executions_spec
  ON avatar_studio.passport_generation_executions(generation_spec_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_execution_events
  ON avatar_studio.passport_execution_events(execution_id,recorded_at,id);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_attempt_events
  ON avatar_studio.passport_provider_attempt_events(attempt_id,recorded_at,id);

CREATE OR REPLACE FUNCTION avatar_studio.enforce_passport_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent avatar_studio.passport_generation_executions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='passport_generation_executions' THEN
    IF NOT EXISTS(SELECT 1 FROM avatar_studio.passport_generation_specs s
      WHERE s.id=NEW.generation_spec_id AND s.workspace_id=NEW.workspace_id AND s.brand_id=NEW.brand_id
      AND s.vertical_code=NEW.vertical_code AND s.character_id=NEW.character_id
      AND s.identity_version_id=NEW.identity_version_id AND s.identity_lock_version_id=NEW.identity_lock_version_id) THEN
      RAISE EXCEPTION 'Passport execution scope/spec mismatch';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO parent FROM avatar_studio.passport_generation_executions
    WHERE id=COALESCE((to_jsonb(NEW)->>'execution_id')::uuid,
      (SELECT execution_id FROM avatar_studio.passport_provider_attempts WHERE id=(to_jsonb(NEW)->>'attempt_id')::uuid));
  IF parent.id IS NULL OR parent.workspace_id<>NEW.workspace_id OR parent.brand_id<>NEW.brand_id
    OR parent.character_id<>NEW.character_id
    OR (to_jsonb(NEW) ? 'vertical_code' AND (to_jsonb(NEW)->>'vertical_code')<>parent.vertical_code) THEN
    RAISE EXCEPTION 'Passport execution workspace/brand/vertical/avatar isolation violation';
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['passport_generation_executions','passport_execution_events',
    'passport_execution_approvals','passport_provider_attempts','passport_provider_attempt_events','passport_execution_results'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope_guard ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_scope_guard BEFORE INSERT ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_passport_execution_scope()',table_name,table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
  END LOOP;
END $$;

COMMIT;
