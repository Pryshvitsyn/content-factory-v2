BEGIN;

-- A locked-stage preflight is immutable, but one preflight may need more than one
-- execution attempt when an earlier attempt failed deterministically before any
-- provider boundary. Preserve every terminal attempt as append-only audit evidence.
ALTER TABLE v2_10.locked_stage_attempts
  DROP CONSTRAINT IF EXISTS locked_stage_attempts_workflow_id_stage_preflight_id_key;

CREATE INDEX IF NOT EXISTS locked_stage_attempt_history
  ON v2_10.locked_stage_attempts(workflow_id, stage, preflight_id, started_at DESC, id DESC);

-- Active-attempt uniqueness is intentionally NOT recreated here.
-- This historical migration is replayed by local startup, while later recovery
-- migrations own the current active-attempt predicate. Recreating the older,
-- stricter predicate here would fail on legitimate append-only recovery history
-- before the newer migration gets a chance to install the authoritative index.
DROP INDEX IF EXISTS v2_10.locked_stage_one_running_attempt;

COMMIT;

-- Forward-only recovery: restore the prior unique constraint only after proving
-- there is at most one historical row per workflow/stage/preflight. Never delete
-- terminal evidence to roll this migration back.