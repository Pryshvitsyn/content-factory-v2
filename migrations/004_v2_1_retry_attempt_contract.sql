BEGIN;

-- Retry hardening: every lease recovery creates the next execution attempt.
-- This makes max_attempts enforceable and keeps attempt history monotonic.
CREATE OR REPLACE FUNCTION v2_1.recover_expired_work()
RETURNS TABLE(jobs_recovered integer,jobs_failed integer,stages_recovered integer,stages_failed integer)
LANGUAGE plpgsql AS $$
DECLARE jr integer:=0; jf integer:=0; sr integer:=0; sf integer:=0;
BEGIN
  WITH expired AS (
    SELECT id, attempt, max_attempts FROM v2_1.stage_runs
     WHERE status='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
     FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE v2_1.stage_runs s SET
      status=CASE WHEN e.attempt < e.max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
      attempt=CASE WHEN e.attempt < e.max_attempts THEN e.attempt + 1 ELSE e.attempt END,
      worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
      next_attempt_at=CASE WHEN e.attempt < e.max_attempts THEN now() ELSE NULL END
     FROM expired e WHERE s.id=e.id RETURNING s.status
  )
  SELECT count(*) FILTER (WHERE status='RETRYING')::int,
         count(*) FILTER (WHERE status='DEAD_LETTER')::int
    INTO sr,sf FROM changed;

  WITH expired AS (
    SELECT id, attempt, max_attempts FROM v2_1.jobs
     WHERE status='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
     FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE v2_1.jobs j SET
      status=CASE WHEN e.attempt < e.max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
      attempt=CASE WHEN e.attempt < e.max_attempts THEN e.attempt + 1 ELSE e.attempt END,
      worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
      next_attempt_at=CASE WHEN e.attempt < e.max_attempts THEN now() ELSE NULL END,
      updated_at=now()
     FROM expired e WHERE j.id=e.id RETURNING j.status
  )
  SELECT count(*) FILTER (WHERE status='RETRYING')::int,
         count(*) FILTER (WHERE status='DEAD_LETTER')::int
    INTO jr,jf FROM changed;

  RETURN QUERY SELECT jr,jf,sr,sf;
END $$;

COMMIT;
