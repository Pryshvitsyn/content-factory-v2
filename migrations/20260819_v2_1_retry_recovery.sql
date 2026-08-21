BEGIN;

CREATE OR REPLACE FUNCTION v2_1.recover_expired_work()
RETURNS TABLE(jobs_recovered integer, jobs_failed integer, stages_recovered integer, stages_failed integer)
LANGUAGE plpgsql AS $$
DECLARE
  job_row record;
  stage_row record;
  next_attempt integer;
  j_recovered integer := 0;
  j_failed integer := 0;
  s_recovered integer := 0;
  s_failed integer := 0;
BEGIN
  FOR stage_row IN
    SELECT * FROM v2_1.stage_runs
    WHERE status='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF stage_row.attempt < stage_row.max_attempts THEN
      next_attempt := stage_row.attempt + 1;
      UPDATE v2_1.stage_runs
      SET status='FAILED', error=jsonb_build_object('code','LEASE_EXPIRED','recovered_at',now()),
          worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=stage_row.id;

      INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint,max_attempts,next_attempt_at,error)
      VALUES (stage_row.job_id,stage_row.stage,next_attempt,'RETRYING',stage_row.input_artifacts,stage_row.input_fingerprint,
              stage_row.max_attempts,now(),jsonb_build_object('code','LEASE_EXPIRED','previous_attempt',stage_row.attempt));
      s_recovered := s_recovered + 1;

      UPDATE v2_1.jobs
      SET status='RETRYING', worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), next_attempt_at=now(),
          error=jsonb_build_object('code','STAGE_LEASE_EXPIRED','stage',stage_row.stage,'previous_attempt',stage_row.attempt),
          updated_at=now()
      WHERE id=stage_row.job_id AND status='RUNNING';
    ELSE
      UPDATE v2_1.stage_runs
      SET status='DEAD_LETTER', error=jsonb_build_object('code','LEASE_EXPIRED_MAX_ATTEMPTS','attempt',stage_row.attempt),
          worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=stage_row.id;
      UPDATE v2_1.jobs
      SET status='FAILED', error=jsonb_build_object('code','STAGE_LEASE_EXPIRED','stage',stage_row.stage),
          worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=stage_row.job_id AND status='RUNNING';
      s_failed := s_failed + 1;
    END IF;
  END LOOP;

  FOR job_row IN
    SELECT * FROM v2_1.jobs
    WHERE status='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
      AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs s WHERE s.job_id=v2_1.jobs.id AND s.status='RUNNING')
    FOR UPDATE SKIP LOCKED
  LOOP
    IF job_row.attempt < job_row.max_attempts THEN
      UPDATE v2_1.jobs
      SET status='RETRYING', attempt=attempt+1, next_attempt_at=now(), worker_id=NULL,
          lease_expires_at=NULL, heartbeat_at=now(),
          error=jsonb_build_object('code','JOB_LEASE_EXPIRED','previous_attempt',job_row.attempt), updated_at=now()
      WHERE id=job_row.id;
      j_recovered := j_recovered + 1;
    ELSE
      UPDATE v2_1.jobs
      SET status='DEAD_LETTER', error=jsonb_build_object('code','JOB_LEASE_EXPIRED_MAX_ATTEMPTS','attempt',job_row.attempt),
          worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=job_row.id;
      j_failed := j_failed + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT j_recovered,j_failed,s_recovered,s_failed;
END $$;

COMMIT;
