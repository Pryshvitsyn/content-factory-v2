BEGIN;
-- Preserve immutable historical attempts. Exclude only the exact proven create-POST validation refusal.
DROP INDEX IF EXISTS v2_10.locked_stage_one_active_attempt;
CREATE UNIQUE INDEX locked_stage_one_active_attempt ON v2_10.locked_stage_attempts(workflow_id,stage)
 WHERE status='RUNNING' OR (status='NEEDS_RECONCILIATION' AND NOT (
   (stage='KEYFRAME' AND boundary_state='MAY_HAVE_STARTED' AND provider_request_id IS NULL
     AND coalesce(error->>'code','')='KEYFRAME_STAGE_FAILED'
     AND coalesce(error->>'message','')='Unsupported quality tier QUALITY')
   OR (stage='FIRST_VIDEO' AND boundary_state='MAY_HAVE_STARTED' AND result='{}'::jsonb AND provider_request_id IS NULL AND coalesce(error->>'code','')='REPLICATE_HTTP_ERROR'
          AND rtrim(coalesce(error->>'message',''),E' \n\r\t')=$rejection$Replicate request failed with HTTP 422: - input.resolution: resolution must be one of the following: "480p", "720p"$rejection$)
 ));
COMMIT;
-- Preserve recovery-aware fences on rollback. Never delete attempts, media rows, or artifacts.
