BEGIN;

-- A locked-stage preflight is immutable, but one preflight may need more than one
-- execution attempt when an earlier attempt failed deterministically before any
-- provider boundary. Preserve every terminal attempt as append-only audit evidence.
ALTER TABLE v2_10.locked_stage_attempts
  DROP CONSTRAINT IF EXISTS locked_stage_attempts_workflow_id_stage_preflight_id_key;

CREATE INDEX IF NOT EXISTS locked_stage_attempt_history
  ON v2_10.locked_stage_attempts(workflow_id, stage, preflight_id, started_at DESC, id DESC);

-- Keep one authoritative active attempt for every workflow/stage. The sole exclusion
-- is the historical opening-keyframe bug that marked the provider boundary before
-- local tier validation. `Unsupported quality tier QUALITY` is thrown by normalizeTier
-- before OpenAI request construction, so a row with no provider_request_id is proven
-- pre-request evidence even though the old runtime labeled it NEEDS_RECONCILIATION.
-- The immutable row remains untouched; a corrected retry is appended beside it.
DROP INDEX IF EXISTS v2_10.locked_stage_one_active_attempt;
DROP INDEX IF EXISTS v2_10.locked_stage_one_running_attempt;
CREATE UNIQUE INDEX locked_stage_one_active_attempt
  ON v2_10.locked_stage_attempts(workflow_id, stage)
  WHERE status = 'RUNNING'
     OR (
       status = 'NEEDS_RECONCILIATION'
       AND NOT (
         stage = 'KEYFRAME'
         AND boundary_state = 'MAY_HAVE_STARTED'
         AND provider_request_id IS NULL
         AND error->>'code' = 'KEYFRAME_STAGE_FAILED'
         AND error->>'message' = 'Unsupported quality tier QUALITY'
       )
     );

COMMIT;

-- Forward-only recovery: restore the prior unique constraint only after proving
-- there is at most one historical row per workflow/stage/preflight. Never delete
-- terminal evidence to roll this migration back.