CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, identity_lock_version_id uuid NOT NULL,
 passport_certification_event_id uuid NOT NULL REFERENCES avatar_studio.passport_certification_events(id),
 certified_chest_up_certification_id uuid NOT NULL REFERENCES avatar_studio.body_reference_certifications(id),
 certified_chest_up_candidate_id uuid NOT NULL REFERENCES avatar_studio.body_reference_candidates(id),
 certified_chest_up_intake_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id),
 specification jsonb NOT NULL, plan_fingerprint text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,plan_fingerprint), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, motion_pilot_plan_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_plans(id),
 provider text NOT NULL, model text NOT NULL, capability text NOT NULL CHECK(capability='IMAGE_TO_VIDEO'), cost_plan jsonb NOT NULL,
 maximum_allowed_cost numeric(14,6) NOT NULL, preflight_snapshot jsonb NOT NULL, preflight_fingerprint text NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_execution_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.motion_pilot_executions(id),
 preflight_fingerprint text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_executions(id),
 idempotency_key text NOT NULL UNIQUE, status text NOT NULL, may_have_spent boolean NOT NULL DEFAULT false,
 provider_request_id text, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
