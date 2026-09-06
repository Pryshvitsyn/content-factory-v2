-- Avatar Performance Runtime: provider rendering remains subordinate to canonical Avatar Studio identity authority.
BEGIN;

CREATE TABLE IF NOT EXISTS avatar_studio.performance_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id), artifact_id text NOT NULL, artifact_version integer NOT NULL,
  content_hash text NOT NULL, technical_evidence jsonb NOT NULL, provenance jsonb NOT NULL, approval_evidence jsonb NOT NULL,
  capture_fingerprint text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(workspace_id,capture_fingerprint), CHECK(artifact_version > 0), CHECK(jsonb_typeof(technical_evidence)='object')
);

CREATE TABLE IF NOT EXISTS avatar_studio.avatar_provider_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id), passport_certification_id uuid NOT NULL REFERENCES avatar_studio.passport_certification_events(id),
  provider text NOT NULL, provider_binding_type text NOT NULL, provider_external_id text NOT NULL, provider_engine_capabilities jsonb NOT NULL,
  performance_capture_id uuid REFERENCES avatar_studio.performance_captures(id), provider_consent_evidence jsonb, binding_revision integer NOT NULL,
  status text NOT NULL, provisioning_evidence jsonb NOT NULL, provider_request_id text, binding_fingerprint text NOT NULL,
  supersedes_binding_id uuid REFERENCES avatar_studio.avatar_provider_bindings(id), superseded_at timestamptz, revoked_at timestamptz, revocation_reason text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(character_id,provider,binding_revision), UNIQUE(workspace_id,binding_fingerprint),
  CHECK(provider IN ('HEYGEN','TAVUS','DID')), CHECK(status IN ('ACTIVE','SUPERSEDED','REVOKED','PROVISIONING_FAILED')),
  CHECK(binding_revision > 0), CHECK(jsonb_typeof(provider_engine_capabilities)='array')
);

CREATE TABLE IF NOT EXISTS avatar_studio.avatar_provider_binding_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), binding_id uuid NOT NULL REFERENCES avatar_studio.avatar_provider_bindings(id),
  action text NOT NULL, successor_binding_id uuid REFERENCES avatar_studio.avatar_provider_bindings(id), reason text,
  recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), CHECK(action IN ('SUPERSEDED','REVOKED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id), provider_binding_id uuid NOT NULL REFERENCES avatar_studio.avatar_provider_bindings(id),
  provider text NOT NULL, provider_engine text NOT NULL, request_fingerprint text NOT NULL, preflight_snapshot jsonb NOT NULL,
  preflight_fingerprint text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(workspace_id,request_fingerprint,provider_binding_id), CHECK(provider IN ('HEYGEN','TAVUS','DID'))
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_execution_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.avatar_performance_executions(id),
  preflight_fingerprint text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES avatar_studio.avatar_performance_executions(id),
  idempotency_key text NOT NULL UNIQUE, request_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES avatar_studio.avatar_performance_attempts(id), status text NOT NULL,
  provider_request_id text, may_have_started boolean NOT NULL DEFAULT false, raw_artifact_id text, raw_artifact_version integer,
  error jsonb, recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status IN ('PROVIDER_INTENT_PERSISTED','MAY_HAVE_STARTED','SUBMITTED','PROVIDER_OUTPUT_CHECKPOINTED','SUCCEEDED','NEEDS_RECONCILIATION'))
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES avatar_studio.avatar_performance_executions(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.avatar_performance_attempts(id), intake_asset_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id),
  artifact_id text NOT NULL, artifact_version integer NOT NULL, provider_request_id text, automatic_qa jsonb NOT NULL, provenance jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(artifact_version > 0)
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_performance_human_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), result_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.avatar_performance_results(id),
  candidate_artifact_id text NOT NULL, candidate_artifact_version integer NOT NULL, decision text NOT NULL, human_note text,
  certified_by text NOT NULL, certified_at timestamptz NOT NULL DEFAULT now(), CHECK(decision IN ('PASS','FAIL')), CHECK(candidate_artifact_version > 0)
);
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_provider_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL, common_intent_fingerprint text NOT NULL, specification jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id), UNIQUE(workspace_id,common_intent_fingerprint)
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_captures','avatar_provider_bindings','avatar_provider_binding_lifecycle_events','avatar_performance_executions','avatar_performance_execution_approvals','avatar_performance_attempts','avatar_performance_attempt_events','avatar_performance_results','avatar_performance_human_certifications','avatar_provider_benchmarks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()', table_name, table_name);
  END LOOP;
END $$;
COMMIT;
