BEGIN;

-- A locked-stage preflight is immutable, but one preflight may need more than one
-- execution attempt when an earlier attempt failed deterministically before any
-- provider boundary. Preserve every terminal attempt as append-only audit evidence.
ALTER TABLE v2_10.locked_stage_attempts
  DROP CONSTRAINT IF EXISTS locked_stage_attempts_workflow_id_stage_preflight_id_key;

CREATE INDEX IF NOT EXISTS locked_stage_attempt_history
  ON v2_10.locked_stage_attempts(workflow_id, stage, preflight_id, started_at DESC, id DESC);

-- The existing partial unique index remains authoritative: at most one RUNNING or
-- NEEDS_RECONCILIATION attempt can exist for a workflow/stage at a time.
CREATE UNIQUE INDEX IF NOT EXISTS locked_stage_one_active_attempt
  ON v2_10.locked_stage_attempts(workflow_id, stage)
  WHERE status IN ('RUNNING','NEEDS_RECONCILIATION');

COMMIT;

-- Forward-only recovery: restore the prior unique constraint only after proving
-- there is at most one historical row per workflow/stage/preflight. Never delete
-- terminal evidence to roll this migration back.
