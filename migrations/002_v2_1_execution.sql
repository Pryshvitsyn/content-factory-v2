BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_1;

-- Canonical V2.1 execution state. This is deliberately separate from the
-- legacy/V2 tables so the worker has an explicit production boundary.
CREATE TABLE IF NOT EXISTS v2_1.productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  immutable_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, idempotency_key),
  CHECK (status IN ('DRAFT','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED','DEAD_LETTER'))
);

CREATE TABLE IF NOT EXISTS v2_1.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 3,
  input_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_fingerprint text,
  output_fingerprint text,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(production_id, idempotency_key),
  CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED','RETRYING','DEAD_LETTER')),
  CHECK (attempt > 0 AND max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS v2_1.stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES v2_1.jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'PENDING',
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  input_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_fingerprint text,
  output_fingerprint text,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(job_id, stage, attempt),
  CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','RETRYING','DEAD_LETTER','SKIPPED')),
  CHECK (attempt > 0 AND max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_v21_jobs_claim ON v2_1.jobs(status, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_v21_jobs_worker ON v2_1.jobs(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_v21_stage_claim ON v2_1.stage_runs(job_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_v21_stage_worker ON v2_1.stage_runs(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_v21_production_status ON v2_1.productions(status, updated_at);

-- PostgreSQL representation of the same canonical ordering as the worker.
CREATE TABLE IF NOT EXISTS v2_1.stage_definitions (
  stage text PRIMARY KEY,
  sequence_no integer NOT NULL UNIQUE,
  terminal boolean NOT NULL DEFAULT false,
  retryable boolean NOT NULL DEFAULT true
);

INSERT INTO v2_1.stage_definitions(stage, sequence_no, terminal) VALUES
('SIGNAL',1,false),('IDEA',2,false),('BRIEF',3,false),('BIBLE',4,false),
('CONCEPT',5,false),('SCRIPT',6,false),('SHOT_PLAN',7,false),('ASSET_PLAN',8,false),
('ASSETS',9,false),('EDIT',10,false),('PLATFORM_ADAPTATION',11,false),
('VALIDATION',12,false),('PUBLISH',13,false),('ANALYZE',14,false),('LEARN',15,true)
ON CONFLICT(stage) DO UPDATE SET sequence_no=EXCLUDED.sequence_no, terminal=EXCLUDED.terminal;

CREATE OR REPLACE FUNCTION v2_1.claim_job(p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.jobs
LANGUAGE plpgsql AS $$
DECLARE r v2_1.jobs;
BEGIN
  IF coalesce(trim(p_worker_id),'') = '' THEN RAISE EXCEPTION 'worker_id is required'; END IF;
  UPDATE v2_1.jobs j
     SET status='QUEUED', worker_id=NULL, lease_expires_at=NULL, heartbeat_at=NULL,
         updated_at=now()
   WHERE j.status='RUNNING' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now();

  SELECT j.* INTO r
    FROM v2_1.jobs j
   WHERE j.status IN ('QUEUED','RETRYING')
     AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
   ORDER BY j.created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

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
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE v2_1.jobs SET status='RUNNING', worker_id=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
    heartbeat_at=now(), started_at=coalesce(started_at,now()), updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  UPDATE v2_1.productions SET status='RUNNING', started_at=coalesce(started_at,now()), updated_at=now()
    WHERE id=p_production_id AND status IN ('DRAFT','RUNNING');
  RETURN NEXT r;
END $$;

CREATE OR REPLACE FUNCTION v2_1.heartbeat_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS boolean LANGUAGE sql AS $$
  UPDATE v2_1.jobs SET lease_expires_at=now()+make_interval(secs=>greatest(5,$3)), heartbeat_at=now(), updated_at=now()
   WHERE id=$1 AND status='RUNNING' AND worker_id=$2 AND (lease_expires_at IS NULL OR lease_expires_at >= now())
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION v2_1.claim_stage(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.stage_runs
LANGUAGE plpgsql AS $$
DECLARE r v2_1.stage_runs; target text; seq integer; prev_done boolean;
BEGIN
  IF coalesce(trim(p_worker_id),'') = '' THEN RAISE EXCEPTION 'worker_id is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2_1.jobs WHERE id=p_job_id AND status='RUNNING' AND worker_id=p_worker_id) THEN RETURN; END IF;

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
   FOR UPDATE SKIP LOCKED LIMIT 1;

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

CREATE OR REPLACE FUNCTION v2_1.heartbeat_stage(p_stage_run_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS boolean LANGUAGE sql AS $$
  UPDATE v2_1.stage_runs SET lease_expires_at=now()+make_interval(secs=>greatest(5,$3)), heartbeat_at=now()
   WHERE id=$1 AND status='RUNNING' AND worker_id=$2 AND (lease_expires_at IS NULL OR lease_expires_at >= now())
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION v2_1.recover_expired_work()
RETURNS TABLE(jobs_recovered integer,jobs_failed integer,stages_recovered integer,stages_failed integer)
LANGUAGE plpgsql AS $$
DECLARE jr integer:=0; jf integer:=0; sr integer:=0; sf integer:=0;
BEGIN
  UPDATE v2_1.stage_runs SET status=CASE WHEN attempt < max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
    worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
    next_attempt_at=CASE WHEN attempt < max_attempts THEN now() ELSE NULL END
   WHERE status='RUNNING' AND lease_expires_at < now();
  GET DIAGNOSTICS sr=ROW_COUNT;
  SELECT count(*)::int INTO sf FROM v2_1.stage_runs WHERE status='DEAD_LETTER' AND updated_at IS NULL;

  UPDATE v2_1.jobs SET status=CASE WHEN attempt < max_attempts THEN 'RETRYING' ELSE 'DEAD_LETTER' END,
    worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(),
    next_attempt_at=CASE WHEN attempt < max_attempts THEN now() ELSE NULL END, updated_at=now()
   WHERE status='RUNNING' AND lease_expires_at < now();
  GET DIAGNOSTICS jr=ROW_COUNT;
  SELECT count(*)::int INTO jf FROM v2_1.jobs WHERE status='DEAD_LETTER' AND updated_at >= now()-interval '1 minute';
  RETURN QUERY SELECT jr,jf,sr,sf;
END $$;

COMMIT;
