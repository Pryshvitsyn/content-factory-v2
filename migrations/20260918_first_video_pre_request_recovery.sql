BEGIN;

CREATE TABLE IF NOT EXISTS v2_10.locked_stage_provider_execution_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES v2_10.locked_stage_attempts(id),
  workflow_id uuid NOT NULL REFERENCES v2_10.locked_keyframe_workflows(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  stage text NOT NULL CHECK (stage IN ('FIRST_VIDEO')),
  provider_request_id text NOT NULL,
  media_execution_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, media_execution_id)
);

DROP TRIGGER IF EXISTS locked_stage_provider_execution_evidence_immutable
  ON v2_10.locked_stage_provider_execution_evidence;
CREATE TRIGGER locked_stage_provider_execution_evidence_immutable
BEFORE UPDATE OR DELETE ON v2_10.locked_stage_provider_execution_evidence
FOR EACH ROW EXECUTE FUNCTION v2_10.protect_locked_keyframe_evidence();

-- Preserve the historical FIRST_VIDEO attempt exactly as recorded, but do not let
-- the one-active-attempt fence treat this one proven pre-request Seedance validation
-- bug as an unresolved provider execution. The old runtime marked MAY_HAVE_STARTED
-- before buildSeedance25Input() validated duration. With no provider_request_id and
-- this exact local validation error, no Replicate POST could have happened.
DROP INDEX IF EXISTS v2_10.locked_stage_one_active_attempt;

CREATE UNIQUE INDEX locked_stage_one_active_attempt
  ON v2_10.locked_stage_attempts(workflow_id, stage)
  WHERE status = 'RUNNING'
     OR (
       status = 'NEEDS_RECONCILIATION'
       AND NOT (
         (
           stage = 'KEYFRAME'
           AND boundary_state = 'MAY_HAVE_STARTED'
           AND provider_request_id IS NULL
           AND error->>'code' = 'KEYFRAME_STAGE_FAILED'
           AND error->>'message' = 'Unsupported quality tier QUALITY'
         )
         OR
         (
           stage = 'FIRST_VIDEO'
           AND boundary_state = 'MAY_HAVE_STARTED'
           AND provider_request_id IS NULL
           AND error->>'code' = 'FIRST_VIDEO_STAGE_FAILED'
           AND error->>'message' = 'Seedance 2.5 duration must be 1-30 seconds'
         )
         OR
         (
           stage = 'FIRST_VIDEO'
           AND boundary_state = 'MAY_HAVE_STARTED'
           AND provider_request_id IS NOT NULL
           AND error->>'code' IN ('REPLICATE_PREDICTION_FAILED','REPLICATE_PREDICTION_CANCELED')
         )
       )
     );

COMMIT;

-- Forward-only recovery: locked-stage attempts are never updated or deleted.
-- Pre-request false boundaries append a corrected attempt only after proving no
-- provider evidence. Terminal provider failures append only after the failed
-- media execution is archived immutably with its provider request id and snapshot.
