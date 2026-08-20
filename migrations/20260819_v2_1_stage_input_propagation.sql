BEGIN;

-- V2.1 canonical stage-boundary fix:
-- every newly claimed stage receives the completed output of the immediately
-- preceding stage as its durable input_artifacts/input_fingerprint.
CREATE OR REPLACE FUNCTION v2_1.claim_stage(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS SETOF v2_1.stage_runs LANGUAGE plpgsql AS $$
DECLARE
  r v2_1.stage_runs;
  target text;
  seq integer;
  previous_outputs jsonb;
  previous_fingerprint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM v2_1.jobs
    WHERE id=p_job_id AND status='RUNNING' AND worker_id=p_worker_id
  ) THEN RETURN; END IF;

  SELECT sd.stage, sd.sequence_no
    INTO target, seq
  FROM v2_1.stage_definitions sd
  WHERE NOT EXISTS (
    SELECT 1 FROM v2_1.stage_runs x
    WHERE x.job_id=p_job_id AND x.stage=sd.stage AND x.status='COMPLETED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM v2_1.stage_definitions p
    WHERE p.sequence_no < sd.sequence_no
      AND NOT EXISTS (
        SELECT 1 FROM v2_1.stage_runs d
        WHERE d.job_id=p_job_id AND d.stage=p.stage AND d.status='COMPLETED'
      )
  )
  ORDER BY sd.sequence_no
  LIMIT 1;

  IF target IS NULL THEN RETURN; END IF;

  -- Serialize claims for the same job/stage. This is deliberately scoped to
  -- the current transaction so concurrent workers cannot both decide that the
  -- initial stage_run is absent and race on UNIQUE(job_id,stage,attempt).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_job_id::text || ':' || target, 0)
  );

  -- Re-check ownership after acquiring the lock. A competing worker may have
  -- created and claimed the stage while this transaction was waiting.
  SELECT s.* INTO r
  FROM v2_1.stage_runs s
  WHERE s.job_id=p_job_id
    AND s.stage=target
    AND s.status='RUNNING'
  ORDER BY s.attempt DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT s.* INTO r
  FROM v2_1.stage_runs s
  WHERE s.job_id=p_job_id
    AND s.stage=target
    AND s.status IN ('RETRYING','PENDING')
    AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
  ORDER BY s.attempt DESC
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT
      COALESCE(prev.output_artifacts, '[]'::jsonb),
      prev.output_fingerprint
    INTO previous_outputs, previous_fingerprint
    FROM v2_1.stage_definitions current_stage
    LEFT JOIN v2_1.stage_definitions previous_stage
      ON previous_stage.sequence_no = current_stage.sequence_no - 1
    LEFT JOIN LATERAL (
      SELECT s.output_artifacts, s.output_fingerprint
      FROM v2_1.stage_runs s
      WHERE s.job_id=p_job_id
        AND s.stage=previous_stage.stage
        AND s.status='COMPLETED'
      ORDER BY s.attempt DESC
      LIMIT 1
    ) prev ON true
    WHERE current_stage.stage=target;

    INSERT INTO v2_1.stage_runs(
      job_id, stage, attempt, status,
      input_artifacts, input_fingerprint, max_attempts
    )
    VALUES(
      p_job_id, target, 1, 'PENDING',
      COALESCE(previous_outputs, '[]'::jsonb), previous_fingerprint, 3
    )
    ON CONFLICT (job_id, stage, attempt) DO NOTHING
    RETURNING * INTO r;

    IF NOT FOUND THEN
      SELECT s.* INTO r
      FROM v2_1.stage_runs s
      WHERE s.job_id=p_job_id
        AND s.stage=target
        AND s.status IN ('RETRYING','PENDING')
        AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
      ORDER BY s.attempt DESC
      LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  UPDATE v2_1.stage_runs
     SET status='RUNNING',
         worker_id=p_worker_id,
         lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
         heartbeat_at=now(),
         started_at=coalesce(started_at,now()),
         updated_at=now()
   WHERE id=r.id
   RETURNING * INTO r;

  RETURN NEXT r;
END $$;

COMMIT;
