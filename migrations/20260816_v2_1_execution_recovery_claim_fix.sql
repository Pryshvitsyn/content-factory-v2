-- V2.1 execution recovery claim fix
-- An expired worker lease is already an observed execution failure. Recovery must
-- make the job immediately reclaimable; retry backoff belongs to stage-level
-- transient failures, not to lease ownership recovery.
--
-- State contract:
--   RUNNING + expired lease -> RETRYING + next_attempt_at = now()
--   RETRYING + due          -> claim_job() -> RUNNING
--
-- This keeps recovery and claiming composable and prevents a recovered job from
-- being stranded behind a backoff window that the caller did not request.

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
           next_attempt_at = CASE
             WHEN attempt < max_attempts
             THEN now() + make_interval(secs => LEAST(300, power(2, LEAST(attempt, 8))::integer))
             ELSE next_attempt_at
           END,
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

  WITH terminal_stage_failures AS (
    SELECT DISTINCT ON (sr.job_id, sr.stage)
           sr.job_id,
           sr.stage,
           sr.status,
           sr.attempt,
           sr.max_attempts
      FROM v2_1.stage_runs sr
     ORDER BY sr.job_id, sr.stage, sr.attempt DESC
  ),
  failed_jobs AS (
    UPDATE v2_1.jobs j
       SET status = 'FAILED',
           error = COALESCE(j.error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
           last_error = COALESCE(j.last_error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
           completed_at = now(),
           worker_id = NULL,
           lease_expires_at = NULL,
           heartbeat_at = now()
      FROM terminal_stage_failures tsf
     WHERE tsf.job_id = j.id
       AND tsf.status = 'FAILED'
       AND tsf.attempt >= tsf.max_attempts
       AND j.status = 'RUNNING'
       AND NOT EXISTS (
         SELECT 1
           FROM v2_1.stage_runs newer
          WHERE newer.job_id = tsf.job_id
            AND newer.stage = tsf.stage
            AND newer.attempt > tsf.attempt
            AND newer.status IN ('QUEUED', 'RETRYING', 'RUNNING', 'COMPLETED')
       )
     RETURNING j.id
  )
  SELECT count(*)::integer INTO jf FROM failed_jobs;

  WITH recovered AS (
    UPDATE v2_1.jobs j
       SET status = CASE WHEN j.attempts < j.max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           -- Lease recovery is immediately reclaimable. Do not apply execution
           -- backoff here; claim_job() remains responsible for atomic ownership.
           next_attempt_at = CASE
             WHEN j.attempts < j.max_attempts THEN now()
             ELSE j.next_attempt_at
           END,
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
  'Recovers expired leases without treating historical failed stage attempts as terminal while a newer retry exists; recovered jobs are immediately reclaimable when retry attempts remain.';
