BEGIN;

ALTER TABLE v2_10.creative_drafts
  ADD COLUMN IF NOT EXISTS preflight_request jsonb,
  ADD COLUMN IF NOT EXISTS start_state text NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS start_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS v210_start_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_start_error jsonb,
  ADD COLUMN IF NOT EXISTS reconciliation_required_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='v2_10.creative_drafts'::regclass AND conname='v2_10_creative_drafts_start_state_check'
  ) THEN
    ALTER TABLE v2_10.creative_drafts ADD CONSTRAINT v2_10_creative_drafts_start_state_check
      CHECK (start_state IN ('IDLE','RUNNING','FAILED_RETRYABLE','NEEDS_RECONCILIATION','SUCCEEDED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS v2_10.start_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('RUNNING','FAILED_RETRYABLE','NEEDS_RECONCILIATION','SUCCEEDED')),
  phase text NOT NULL DEFAULT 'CLAIMED',
  boundary_state text NOT NULL DEFAULT 'NOT_CROSSED'
    CHECK (boundary_state IN ('NOT_CROSSED','MAY_HAVE_STARTED','CANONICAL_CREATED')),
  preflight_fingerprint text NOT NULL,
  canonical_input_fingerprint text,
  production_id uuid REFERENCES v2_1.productions(id),
  error jsonb,
  actor text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_10_one_running_start_per_draft
  ON v2_10.start_attempts(draft_id) WHERE status='RUNNING';

DROP TRIGGER IF EXISTS start_attempt_scope ON v2_10.start_attempts;
CREATE TRIGGER start_attempt_scope BEFORE INSERT OR UPDATE ON v2_10.start_attempts
  FOR EACH ROW EXECUTE FUNCTION v2_10.enforce_brand_workspace();

CREATE OR REPLACE FUNCTION v2_10.protect_start_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'V2.10 start attempt evidence is immutable'; END IF;
  IF OLD.status <> 'RUNNING' THEN RAISE EXCEPTION 'terminal V2.10 start attempt evidence is immutable'; END IF;
  IF NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.attempt IS DISTINCT FROM OLD.attempt
    OR NEW.preflight_fingerprint IS DISTINCT FROM OLD.preflight_fingerprint OR NEW.actor IS DISTINCT FROM OLD.actor
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'V2.10 start attempt identity is immutable';
  END IF;
  IF NEW.status='RUNNING' THEN RAISE EXCEPTION 'V2.10 running start attempt may only transition to terminal state'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS start_attempt_immutable ON v2_10.start_attempts;
CREATE TRIGGER start_attempt_immutable BEFORE UPDATE OR DELETE ON v2_10.start_attempts
  FOR EACH ROW EXECUTE FUNCTION v2_10.protect_start_attempt();

CREATE OR REPLACE FUNCTION v2_10.guard_active_start_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.start_state IN ('RUNNING','NEEDS_RECONCILIATION') AND (
    NEW.creative_brief IS DISTINCT FROM OLD.creative_brief OR
    NEW.provider_selection IS DISTINCT FROM OLD.provider_selection OR
    NEW.voice_selection IS DISTINCT FROM OLD.voice_selection OR
    NEW.voice_approval IS DISTINCT FROM OLD.voice_approval
  ) THEN
    RAISE EXCEPTION 'V2.10 creative input cannot change while start is running or requires reconciliation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS creative_draft_active_start_guard ON v2_10.creative_drafts;
CREATE TRIGGER creative_draft_active_start_guard BEFORE UPDATE ON v2_10.creative_drafts
  FOR EACH ROW EXECUTE FUNCTION v2_10.guard_active_start_edit();

COMMIT;
