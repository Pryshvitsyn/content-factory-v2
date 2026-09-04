-- Append-only automatic QA. A new evaluator or policy produces a new
-- assessment; the historical assessment is never rewritten.
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_automatic_qa_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL REFERENCES avatar_studio.characters(id),
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  result_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_results(id),
  result_content_hash text NOT NULL,
  identity_truth_fingerprint text NOT NULL,
  body_reference_fingerprint text NOT NULL,
  task_profile_id text NOT NULL,
  task_profile_version text NOT NULL,
  qa_policy_version text NOT NULL,
  evaluator_provenance jsonb NOT NULL,
  sampled_frames jsonb NOT NULL,
  dimensions jsonb NOT NULL,
  aggregate jsonb NOT NULL,
  assessment_fingerprint text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motion_pilot_auto_qa_result_created_idx
  ON avatar_studio.motion_pilot_automatic_qa_assessments(result_id,created_at DESC,id DESC);

-- A batch is a bounded, approved orchestration envelope. Individual children
-- remain separate immutable one-call executions; a live start is still gated
-- by the service's QA readiness checks.
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_quality_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  vertical_code text NOT NULL,
  character_id uuid NOT NULL REFERENCES avatar_studio.characters(id),
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
  identity_truth_fingerprint text NOT NULL,
  body_reference_fingerprint text NOT NULL,
  task_profile jsonb NOT NULL,
  allowed_route_ids jsonb NOT NULL,
  preferred_route_id text NOT NULL,
  maximum_variants integer NOT NULL CHECK(maximum_variants > 0),
  maximum_total_cost_usd numeric(14,6) NOT NULL CHECK(maximum_total_cost_usd >= 0),
  stop_on_first_auto_qa_pass boolean NOT NULL DEFAULT true,
  automatic_retry_allowed boolean NOT NULL DEFAULT false CHECK(automatic_retry_allowed=false),
  approval_metadata jsonb,
  status text NOT NULL CHECK(status IN ('PLANNED','AWAITING_APPROVAL','APPROVED','BLOCKED','RUNNING','CANCELLED','AWAITING_HUMAN_CERTIFICATION','COMPLETE','STOPPED')),
  cumulative_planned_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  cumulative_actual_known_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  selected_result_id uuid REFERENCES avatar_studio.motion_pilot_results(id),
  stop_reason text,
  policy_version text NOT NULL,
  specification jsonb NOT NULL,
  batch_fingerprint text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_quality_batch_children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_quality_batches(id),
  execution_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.motion_pilot_executions(id),
  ordinal integer NOT NULL CHECK(ordinal > 0),
  route_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('PLANNED','AUTHORIZED','PROVIDER_DISPATCHED','RAW_CHECKPOINTED','CANONICALIZED','QA_RUNNING','QA_COMPLETE','SELECTED','REJECTED','UNCERTAIN','CANCELLED')),
  provider_request_id text,
  assessment_id uuid REFERENCES avatar_studio.motion_pilot_automatic_qa_assessments(id),
  stop_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,ordinal)
);
CREATE INDEX IF NOT EXISTS motion_pilot_batch_scope_created_idx
  ON avatar_studio.motion_pilot_quality_batches(character_id,identity_version_id,created_at DESC,id DESC);
