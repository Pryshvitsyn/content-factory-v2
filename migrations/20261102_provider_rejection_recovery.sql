BEGIN;
-- Supersedes the replayed September retry migration without rewriting evidence.
ALTER TABLE v2_10.locked_stage_attempts
  DROP CONSTRAINT IF EXISTS locked_stage_attempts_workflow_id_stage_preflight_id_key;
CREATE INDEX IF NOT EXISTS locked_stage_attempt_history
  ON v2_10.locked_stage_attempts(workflow_id,stage,preflight_id,started_at DESC,id DESC);

CREATE OR REPLACE FUNCTION v2_10.locked_stage_attempt_blocks(a v2_10.locked_stage_attempts)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
 SELECT a.status='RUNNING' OR (a.status='NEEDS_RECONCILIATION' AND NOT (
   (a.stage='KEYFRAME' AND a.boundary_state='MAY_HAVE_STARTED' AND a.provider_request_id IS NULL
     AND coalesce(a.error->>'code','')='KEYFRAME_STAGE_FAILED'
     AND coalesce(a.error->>'message','')='Unsupported quality tier QUALITY')
   OR (a.stage='FIRST_VIDEO' AND a.boundary_state='MAY_HAVE_STARTED' AND a.result='{}'::jsonb
     AND a.provider_request_id IS NULL AND coalesce(a.error->>'code','')='REPLICATE_HTTP_ERROR'
     AND rtrim(coalesce(a.error->>'message',''),E' \n\r\t')=$rejection$Replicate request failed with HTTP 422: - input.resolution: resolution must be one of the following: "480p", "720p"$rejection$)
  ));
$function$;

-- Historical unresolved attempts may coexist. Keep them all, but forbid a new
-- active attempt beside any unresolved evidence. Serialize with the same key as
-- the repository, including direct SQL inserts that bypass its claim method.
CREATE OR REPLACE FUNCTION v2_10.fence_locked_stage_insert()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
 IF NOT v2_10.locked_stage_attempt_blocks(NEW) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('locked-stage:' || NEW.workflow_id::text || ':' || NEW.stage));
 IF EXISTS (SELECT 1 FROM v2_10.locked_stage_attempts a
   WHERE a.workflow_id=NEW.workflow_id AND a.stage=NEW.stage
     AND v2_10.locked_stage_attempt_blocks(a)) THEN
   RAISE EXCEPTION USING ERRCODE='23505',
     MESSAGE='Existing locked-stage attempt must be reconciled before starting another';
 END IF;
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS locked_stage_insert_fence ON v2_10.locked_stage_attempts;
CREATE TRIGGER locked_stage_insert_fence BEFORE INSERT ON v2_10.locked_stage_attempts
 FOR EACH ROW EXECUTE FUNCTION v2_10.fence_locked_stage_insert();

DROP INDEX IF EXISTS v2_10.locked_stage_one_active_attempt;
DROP INDEX IF EXISTS v2_10.locked_stage_one_running_attempt;
CREATE UNIQUE INDEX locked_stage_one_active_attempt ON v2_10.locked_stage_attempts(workflow_id,stage)
 WHERE status='RUNNING';
COMMIT;
-- Forward-only: retain the trigger fence and immutable historical rows.
