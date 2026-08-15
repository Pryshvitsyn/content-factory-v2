-- V2.1 execution recovery fix
-- Correct the job recovery statement so the UPDATE target is explicitly aliased.
-- PostgreSQL does not expose the table name `j` in the NOT EXISTS predicate
-- unless the UPDATE target is declared as `jobs j`.

CREATE OR REPLACE FUNCTION v2_1.recover_expired_work()
RETURNS TABLE (jobs_recovered integer, jobs_failed integer, stages_recovered integer, stages_failed integer)
LANGUAGE plpgsql AS $$
DECLARE
  jr integer := 0;
  jf integer := 0;
  sr integer := 0;
  sf integer := 0;
BEGIN
  WITH recovered AS (
    UPDATE v2_1.stage_runs
       SET status = CASE WHEN attempt < max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           next_attempt_at = now() + make_interval(secs => LEAST(300, power(2, LEAST(attempt, 8))::integer)),
           error = CASE
             WHEN attempt < max_attempts THEN error
             ELSE COALESCE(error, jsonb_build_object('code','STAGE_LEASE_EXPIRED'))
           END,
           worker_id = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL
     WHERE status = 'RUNNING'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
     RETURNING status
  )
  SELECT
    count(*) FILTER (WHERE status = 'RETRYING')::integer,
    count(*) FILTER (WHERE status = 'FAILED')::integer
  INTO sr, sf
  FROM recovered;

  UPDATE v2_1.jobs j
     SET status = 'FAILED',
         error = COALESCE(j.error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
         last_error = COALESCE(j.last_error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
         completed_at = now(),
         worker_id = NULL,
         lease_expires_at = NULL,
         heartbeat_at = now()
   WHERE j.status = 'RUNNING'
     AND EXISTS (
       SELECT 1
       FROM v2_1.stage_runs srx
       WHERE srx.job_id = j.id
         AND srx.status = 'FAILED'
     );

  WITH recovered AS (
    UPDATE v2_1.jobs j
       SET status = CASE WHEN j.attempts < j.max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           next_attempt_at = now() + make_interval(secs => LEAST(300, power(2, LEAST(j.attempts, 8))::integer)),
           error = CASE
             WHEN j.attempts < j.max_attempts THEN j.error
             ELSE COALESCE(j.error, jsonb_build_object('code','JOB_LEASE_EXPIRED'))
           END,
           last_error = COALESCE(j.last_error, jsonb_build_object('code','JOB_LEASE_EXPIRED')),
           worker_id = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL
     WHERE j.status = 'RUNNING'
       AND j.lease_expires_at IS NOT NULL
       AND j.lease_expires_at < now()
       AND NOT EXISTS (
         SELECT 1
         FROM v2_1.stage_runs srx
         WHERE srx.job_id = j.id
           AND srx.status = 'RUNNING'
           AND (srx.lease_expires_at IS NULL OR srx.lease_expires_at > now())
       )
     RETURNING status
  )
  SELECT
    count(*) FILTER (WHERE status = 'RETRYING')::integer,
    count(*) FILTER (WHERE status = 'FAILED')::integer
  INTO jr, jf
  FROM recovered;

  RETURN QUERY SELECT jr, jf, sr, sf;
END;
$$;

COMMENT ON FUNCTION v2_1.recover_expired_work() IS
  'Recovers expired stage/job leases and schedules retry work atomically; job UPDATE targets are explicitly aliased for PostgreSQL scope correctness.';
