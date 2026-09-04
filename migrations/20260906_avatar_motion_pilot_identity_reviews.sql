CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_identity_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
 identity_version_id uuid NOT NULL, execution_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_executions(id),
 attempt_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_attempts(id), result_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_results(id),
 decision text NOT NULL CHECK(decision IN ('PASS','FAIL')), reason_code text NOT NULL,
 human_note text, reviewed_by text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE UPDATE, DELETE ON avatar_studio.motion_pilot_identity_reviews FROM PUBLIC;
