BEGIN;

-- Contract hardening for 002: deterministic lock syntax, ownership locking,
-- and accurate recovery counters. Keep this as a separate migration so 002
-- remains historically auditable.
CREATE OR REPLACE FUNCTION v2_1.claim_job(p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.jobs
LANGUAGE plpgsql AS $$
DECLARE r v2_1.jobs;
BEGIN
  IF coalesce(trim(p_worker_id),'') = '' THEN RAISE EXCEPTION 'worker_id is required'; END IF;

  SELECT j.* INTO r
    FROM v2_1.jobs j
   WHERE j.status IN ('QUEUED','RETRYING')
     AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
   ORDER BY j.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE v2_1.jobs
     SET status='RUNNING', worker_id=p_worker_id,
         lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
         heartbeat_at=now(), started_at=coalesce(started_at,now()), updated_at=now()
   WHERE id=r.id
   RETURNING * INTO r;
  RETURN NEXT r;
END $$;

CREATE OR REPLACE FUNCTION v2_1.claim_job_for_production(p_job_id uuid, p_production_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.jobs
LANGUAGE plpgsql AS $$
DECLARE r v2_1.jobs;
BEGIN
  IF coalesce(trim(p_worker_id),'') = '' THEN RAISE EXCEPTION 'worker_id is required'; END IF;
  SELECT j.* INTO r FROM v2_1.jobs j
   WHERE j.id=p_job_id AND j.production_id=p_production_id
     AND j.status IN ('QUEUED','RETRYING')
     AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE v2_1.jobs SET status='RUNNING', worker_id=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
    heartbeat_at=now(), started_at=coalesce(started_at,now()), updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  UPDATE v2_1.productions SET status='RUNNING', started_at=coalesce(started_at,now()), updated_at=now()
    WHERE id=p_production_id AND status IN ('DRAFT','RUNNING');
  RETURN NEXT r;
END $$;

CREATE OR REPLACE FUNCTION v2_1.claim_stage(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.stage_runs
LANGUAGE plpgsql AS $$
DECLARE r v2_1.stage_runs; target text; seq integer; prev_done boolean;
BEGIN
  IF coalesce(trim(p_worker_id),'') = '' THEN RAISE EXCEPTION 'worker_id is required'; END IF;

  -- Serialize stage claims for one running job. Without this lock two workers
  -- can both observe the same missing stage and race on the UNIQUE constraint.
  IF NOT EXISTS (
    SELECT 1 FROM v2_1.jobs
     WHERE id=p_job_id AND status='RUNNING' AND worker_id=p_worker_id
     FOR UPDATE
  ) THEN RETURN; END IF;

  SELECT sd.stage, sd.sequence_no INTO target, seq
    FROM v2_1.stage_definitions sd
   WHERE NOT EXISTS (SELECT 1 FROM v2_1.stage_runs x WHERE x.job_id=p_job_id AND x.stage=sd.stage AND x.status='COMPLETED')
   ORDER BY sd.sequence_no LIMIT 1;
  IF target IS NULL THEN RETURN; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM v2_1.stage_definitions p
     WHERE p.sequence_no < seq
       AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs d WHERE d.job_id=p_job_id AND d.stage=p.stage AND d.status='COMPLETED')
  ) INTO prev_done;
  IF NOT prev_done THEN RETURN; END IF;

  SELECT s.* INTO r FROM v2_1.stage_runs s
   WHERE s.job_id=p_job_id AND s.stage=target
     AND s.status IN ('RETRYING','PENDING')
     AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
   ORDER BY s.attempt DESC
   LIMIT 1 FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,max_attempts)
    VALUES(p_job_id,target,1,'PENDING',3) RETURNING * INTO r;
  END IF;

  UPDATE v2_1.stage_runs SET status='RUNNING', worker_id=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
    heartbeat_at=now(), started_at=coalesce(started_at,now())
    WHERE id=r.id RETURNING * INTO r;
  RETURN NEXT r;
END $$;

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
    UPDATE v2_1.stage_runs s SET status=CASE WHEN e.attempt < e.max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
      worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
      next_attempt_at=CASE WHEN e.attempt < e.max_attempts THEN now() ELSE NULL END
     FROM expired e WHERE s.id=e.id RETURNING s.status
  ) SELECT count(*) FILTER (WHERE status='RETRYING')::int, count(*) FILTER (WHERE status='DEAD_LETTER')::int INTO sr,sf FROM changed;

  WITH expired AS (
    SELECT id, attempt, max_attempts FROM v2_1.jobs
     WHERE status='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
     FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE v2_1.jobs j SET status=CASE WHEN e.attempt < e.max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
      worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
      next_attempt_at=CASE WHEN e.attempt < e.max_attempts THEN now() ELSE NULL END, updated_at=now()
     FROM expired e WHERE j.id=e.id RETURNING j.status
  ) SELECT count(*) FILTER (WHERE status='RETRYING')::int, count(*) FILTER (WHERE status='DEAD_LETTER')::int INTO jr,jf FROM changed;

  RETURN QUERY SELECT jr,jf,sr,sf;
END $$;

COMMIT;
