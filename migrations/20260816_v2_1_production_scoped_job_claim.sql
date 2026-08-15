-- V2.1 production-scoped job claiming
--
-- A production orchestrator already knows the exact job it is executing.
-- Generic claim_job() intentionally selects any runnable job from the queue,
-- which is correct for a fleet worker but unsafe for a production-specific
-- vertical slice: another queued job could be claimed accidentally.
--
-- This function makes the production/job boundary explicit in PostgreSQL.
-- The database will only grant the lease when BOTH the requested job id and
-- production id match the same row.

CREATE OR REPLACE FUNCTION v2_1.claim_job_for_production(
  p_job_id uuid,
  p_production_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  id uuid,
  production_id uuid,
  job_type text,
  attempts integer,
  lease_expires_at timestamptz
)
LANGUAGE sql AS $$
  WITH candidate AS (
    SELECT j.id
      FROM v2_1.jobs j
     WHERE j.id = p_job_id
       AND j.production_id = p_production_id
       AND j.status IN ('QUEUED','RETRYING')
       AND j.next_attempt_at <= now()
       AND j.attempts < j.max_attempts
       AND NOT EXISTS (
         SELECT 1
           FROM v2_1.stage_runs sr
          WHERE sr.job_id = j.id
            AND sr.status = 'RUNNING'
            AND (sr.lease_expires_at IS NULL OR sr.lease_expires_at > now())
       )
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE v2_1.jobs j
       SET status = 'RUNNING',
           attempts = j.attempts + 1,
           worker_id = p_worker_id,
           heartbeat_at = now(),
           lease_expires_at = now() + make_interval(secs => GREATEST(5, p_lease_seconds))
      FROM candidate c
     WHERE j.id = c.id
     RETURNING j.id, j.production_id, j.job_type, j.attempts, j.lease_expires_at
  )
  SELECT * FROM claimed;
$$;

COMMENT ON FUNCTION v2_1.claim_job_for_production(uuid, uuid, text, integer) IS
  'Atomically claims exactly the requested production job and rejects cross-production queue claims at the database boundary.';
