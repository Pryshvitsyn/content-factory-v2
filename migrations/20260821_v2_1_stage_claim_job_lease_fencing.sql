BEGIN;

-- Fence stage acquisition on the parent job lease as well as worker identity.
-- Serialize contenders for the same job/stage before checking ownership so
-- concurrent claimers cannot both create the same stage attempt.
CREATE OR REPLACE FUNCTION v2_1.claim_stage(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.stage_runs LANGUAGE plpgsql AS $$
DECLARE r v2_1.stage_runs; target text; seq integer;
BEGIN
  SELECT sd.stage, sd.sequence_no INTO target, seq FROM v2_1.stage_definitions sd
   WHERE NOT EXISTS (SELECT 1 FROM v2_1.stage_runs x WHERE x.job_id=p_job_id AND x.stage=sd.stage AND x.status='COMPLETED')
   AND NOT EXISTS (
     SELECT 1 FROM v2_1.stage_definitions p WHERE p.sequence_no < sd.sequence_no
       AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs d WHERE d.job_id=p_job_id AND d.stage=p.stage AND d.status='COMPLETED')
   )
   ORDER BY sd.sequence_no LIMIT 1;
  IF target IS NULL THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_job_id::text || ':' || target, 0));

  -- Re-check the parent job after serialization. A concurrent recovery can
  -- expire or clear ownership while another transaction is waiting here.
  IF NOT EXISTS (
    SELECT 1 FROM v2_1.jobs
    WHERE id=p_job_id
      AND status='RUNNING'
      AND worker_id=p_worker_id
      AND (lease_expires_at IS NULL OR lease_expires_at >= now())
  ) THEN RETURN; END IF;

  -- If another contender already owns the active stage, do not create a
  -- duplicate attempt. The unique (job_id, stage, attempt) constraint is a
  -- safety net, not the concurrency protocol.
  IF EXISTS (
    SELECT 1 FROM v2_1.stage_runs
    WHERE job_id=p_job_id AND stage=target AND status='RUNNING'
  ) THEN RETURN; END IF;

  SELECT s.* INTO r FROM v2_1.stage_runs s WHERE s.job_id=p_job_id AND s.stage=target
    AND s.status IN ('RETRYING','PENDING') AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
    ORDER BY s.attempt DESC FOR UPDATE SKIP LOCKED LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,max_attempts)
    VALUES(p_job_id,target,1,'PENDING',3)
    RETURNING * INTO r;
  END IF;

  UPDATE v2_1.stage_runs SET status='RUNNING', worker_id=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)), heartbeat_at=now(),
    started_at=coalesce(started_at,now()), updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN NEXT r;
END $$;

COMMIT;
