BEGIN;

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
       )
     );

COMMIT;

-- Forward-only recovery: the historical terminal attempt is never updated or
-- deleted. A corrected execution appends a new RUNNING attempt after repository
-- code proves there is no durable provider request or media artifact evidence.
