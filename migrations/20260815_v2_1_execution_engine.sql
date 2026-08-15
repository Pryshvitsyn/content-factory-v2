-- V2.1 execution engine boundary
-- PostgreSQL owns queue claiming, leases, dependency readiness and retry state.
-- The worker is an executor, never the source of truth for orchestration state.

CREATE TABLE IF NOT EXISTS v2_1.stage_definitions (
  stage text PRIMARY KEY,
  requires jsonb NOT NULL DEFAULT '[]'::jsonb,
  outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  parallel_group text
);

INSERT INTO v2_1.stage_definitions(stage, requires, outputs, parallel_group) VALUES
  ('SIGNAL', '[]'::jsonb, '["SIGNAL_SET"]'::jsonb, NULL),
  ('IDEA', '["SIGNAL_SET"]'::jsonb, '["IDEA_SET"]'::jsonb, NULL),
  ('BRIEF', '["IDEA_SET"]'::jsonb, '["CONTENT_BRIEF"]'::jsonb, NULL),
  ('CONCEPT', '["CONTENT_BRIEF"]'::jsonb, '["CONCEPT"]'::jsonb, NULL),
  ('SCRIPT', '["CONCEPT"]'::jsonb, '["SCRIPT"]'::jsonb, NULL),
  ('BIBLE', '["SCRIPT"]'::jsonb, '["PRODUCTION_BIBLE"]'::jsonb, NULL),
  ('ASSET_PLAN', '["PRODUCTION_BIBLE"]'::jsonb, '["ASSET_REQUIREMENTS"]'::jsonb, NULL),
  ('SHOT_PLAN', '["PRODUCTION_BIBLE","SCRIPT"]'::jsonb, '["SHOTS"]'::jsonb, NULL),
  ('ASSET_GENERATION', '["ASSET_REQUIREMENTS"]'::jsonb, '["ASSETS"]'::jsonb, 'GENERATION'),
  ('CONTINUITY', '["SHOTS","ASSETS","PRODUCTION_BIBLE"]'::jsonb, '["CONTINUITY_REPORT"]'::jsonb, NULL),
  ('EDIT', '["SHOTS","ASSETS","CONTINUITY_REPORT"]'::jsonb, '["EDIT"]'::jsonb, NULL),
  ('PLATFORM_ADAPTATION', '["EDIT"]'::jsonb, '["EDITIONS"]'::jsonb, 'PLATFORM'),
  ('VALIDATION', '["EDITIONS"]'::jsonb, '["VALIDATION_REPORT"]'::jsonb, NULL),
  ('PUBLISH', '["VALIDATION_REPORT","EDITIONS"]'::jsonb, '["PUBLICATIONS"]'::jsonb, 'PLATFORM'),
  ('ANALYZE', '["PUBLICATIONS"]'::jsonb, '["PERFORMANCE_DATA"]'::jsonb, NULL),
  ('LEARN', '["PERFORMANCE_DATA"]'::jsonb, '["LEARNINGS"]'::jsonb, NULL)
ON CONFLICT (stage) DO UPDATE SET requires = EXCLUDED.requires, outputs = EXCLUDED.outputs, parallel_group = EXCLUDED.parallel_group;

ALTER TABLE v2_1.jobs
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_error jsonb;

ALTER TABLE v2_1.stage_runs
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS input_fingerprint text,
  ADD COLUMN IF NOT EXISTS output_fingerprint text;

ALTER TABLE v2_1.jobs DROP CONSTRAINT IF EXISTS jobs_max_attempts_check;
ALTER TABLE v2_1.jobs ADD CONSTRAINT jobs_max_attempts_check CHECK (max_attempts > 0);
ALTER TABLE v2_1.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_max_attempts_check;
ALTER TABLE v2_1.stage_runs ADD CONSTRAINT stage_runs_max_attempts_check CHECK (max_attempts > 0);

CREATE INDEX IF NOT EXISTS idx_v21_jobs_claim ON v2_1.jobs(status, next_attempt_at, priority DESC, created_at) WHERE status IN ('QUEUED','RETRYING');
CREATE INDEX IF NOT EXISTS idx_v21_jobs_lease ON v2_1.jobs(lease_expires_at) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS idx_v21_stage_runs_claim ON v2_1.stage_runs(job_id, status, next_attempt_at, stage) WHERE status IN ('QUEUED','RETRYING');
CREATE INDEX IF NOT EXISTS idx_v21_stage_runs_lease ON v2_1.stage_runs(lease_expires_at) WHERE status = 'RUNNING';

CREATE OR REPLACE FUNCTION v2_1.recover_expired_work()
RETURNS TABLE (jobs_recovered integer, jobs_failed integer, stages_recovered integer, stages_failed integer)
LANGUAGE plpgsql AS $$
DECLARE jr integer := 0; jf integer := 0; sr integer := 0; sf integer := 0;
BEGIN
  WITH recovered AS (
    UPDATE v2_1.stage_runs
       SET status = CASE WHEN attempt < max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           next_attempt_at = now() + make_interval(secs => LEAST(300, power(2, LEAST(attempt, 8))::integer)),
           error = CASE WHEN attempt < max_attempts THEN error ELSE COALESCE(error, jsonb_build_object('code','STAGE_LEASE_EXPIRED')) END,
           worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL
     WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
     RETURNING status
  ) SELECT count(*) FILTER (WHERE status = 'RETRYING')::integer, count(*) FILTER (WHERE status = 'FAILED')::integer INTO sr, sf FROM recovered;

  UPDATE v2_1.jobs j
     SET status = 'FAILED', error = COALESCE(j.error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
         last_error = COALESCE(j.last_error, jsonb_build_object('code','STAGE_RETRY_EXHAUSTED')),
         completed_at = now(), worker_id = NULL, lease_expires_at = NULL, heartbeat_at = now()
   WHERE j.status = 'RUNNING' AND EXISTS (SELECT 1 FROM v2_1.stage_runs srx WHERE srx.job_id = j.id AND srx.status = 'FAILED');

  WITH recovered AS (
    UPDATE v2_1.jobs
       SET status = CASE WHEN attempts < max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           next_attempt_at = now() + make_interval(secs => LEAST(300, power(2, LEAST(attempts, 8))::integer)),
           error = CASE WHEN attempts < max_attempts THEN error ELSE COALESCE(error, jsonb_build_object('code','JOB_LEASE_EXPIRED')) END,
           last_error = COALESCE(last_error, jsonb_build_object('code','JOB_LEASE_EXPIRED')),
           worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL
     WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
       AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs srx WHERE srx.job_id = j.id AND srx.status = 'RUNNING' AND (srx.lease_expires_at IS NULL OR srx.lease_expires_at > now()))
     RETURNING status
  ) SELECT count(*) FILTER (WHERE status = 'RETRYING')::integer, count(*) FILTER (WHERE status = 'FAILED')::integer INTO jr, jf FROM recovered;

  RETURN QUERY SELECT jr, jf, sr, sf;
END;
$$;

CREATE OR REPLACE FUNCTION v2_1.claim_job(p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE (id uuid, production_id uuid, job_type text, attempts integer, lease_expires_at timestamptz)
LANGUAGE sql AS $$
  WITH candidate AS (
    SELECT j.id FROM v2_1.jobs j
     WHERE j.status IN ('QUEUED','RETRYING') AND j.next_attempt_at <= now() AND j.attempts < j.max_attempts
       AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs sr WHERE sr.job_id = j.id AND sr.status = 'RUNNING' AND (sr.lease_expires_at IS NULL OR sr.lease_expires_at > now()))
     ORDER BY j.priority DESC, j.created_at, j.id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE v2_1.jobs j SET status = 'RUNNING', attempts = j.attempts + 1, worker_id = p_worker_id,
           heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => GREATEST(5, p_lease_seconds))
      FROM candidate c WHERE j.id = c.id
     RETURNING j.id, j.production_id, j.job_type, j.attempts, j.lease_expires_at
  ) SELECT * FROM claimed;
$$;

CREATE OR REPLACE FUNCTION v2_1.heartbeat_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE sql AS $$
  UPDATE v2_1.jobs SET heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => GREATEST(5, p_lease_seconds))
   WHERE id = p_job_id AND status = 'RUNNING' AND worker_id = p_worker_id RETURNING true;
$$;

CREATE OR REPLACE FUNCTION v2_1.claim_stage(p_job_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE (id uuid, stage text, attempt integer, input_artifacts jsonb, input_fingerprint text, lease_expires_at timestamptz)
LANGUAGE sql AS $$
  WITH candidate AS (
    SELECT sr.id FROM v2_1.stage_runs sr JOIN v2_1.jobs j ON j.id = sr.job_id JOIN v2_1.stage_definitions sd ON sd.stage = sr.stage
     WHERE sr.job_id = p_job_id AND j.status = 'RUNNING'
       AND sr.status IN ('QUEUED','RETRYING') AND sr.next_attempt_at <= now() AND sr.attempt < sr.max_attempts
       AND NOT EXISTS (SELECT 1 FROM v2_1.stage_runs done WHERE done.job_id = sr.job_id AND done.stage = sr.stage AND done.status = 'COMPLETED')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(sd.requires) required_artifact WHERE NOT EXISTS (
         SELECT 1 FROM v2_1.stage_runs done WHERE done.job_id = sr.job_id AND done.status = 'COMPLETED' AND done.output_artifacts ? required_artifact
       ))
     ORDER BY sr.id FOR UPDATE OF sr SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE v2_1.stage_runs sr SET status = 'RUNNING', worker_id = p_worker_id, started_at = COALESCE(sr.started_at, now()),
           heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => GREATEST(5, p_lease_seconds))
      FROM candidate c WHERE sr.id = c.id
     RETURNING sr.id, sr.stage, sr.attempt, sr.input_artifacts, sr.input_fingerprint, sr.lease_expires_at
  ) SELECT * FROM claimed;
$$;

CREATE OR REPLACE FUNCTION v2_1.heartbeat_stage(p_stage_run_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE sql AS $$
  UPDATE v2_1.stage_runs SET heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => GREATEST(5, p_lease_seconds))
   WHERE id = p_stage_run_id AND status = 'RUNNING' AND worker_id = p_worker_id RETURNING true;
$$;

COMMENT ON TABLE v2_1.stage_definitions IS 'Database execution contract: dependency readiness and stage outputs used by atomic workers.';
COMMENT ON COLUMN v2_1.jobs.lease_expires_at IS 'Worker lease; expired leases are recoverable by the database recovery function.';
COMMENT ON COLUMN v2_1.stage_runs.input_fingerprint IS 'Deterministic identity of the stage input snapshot; used for retry-safe execution.';
