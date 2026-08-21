BEGIN;

-- Heartbeat functions must return an explicit boolean even when the ownership
-- predicate matches no row. NULL is not a valid negative result for callers.
CREATE OR REPLACE FUNCTION v2_1.heartbeat_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE v2_1.jobs
     SET lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
         heartbeat_at=now(), updated_at=now()
   WHERE id=p_job_id AND status='RUNNING' AND worker_id=p_worker_id
     AND (lease_expires_at IS NULL OR lease_expires_at >= now());
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION v2_1.heartbeat_stage(p_stage_run_id uuid, p_worker_id text, p_lease_seconds integer)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE v2_1.stage_runs
     SET lease_expires_at=now()+make_interval(secs=>greatest(5,p_lease_seconds)),
         heartbeat_at=now()
   WHERE id=p_stage_run_id AND status='RUNNING' AND worker_id=p_worker_id
     AND (lease_expires_at IS NULL OR lease_expires_at >= now());
  RETURN FOUND;
END $$;

-- The worker's 19-stage production contract is the canonical execution order.
-- Keep the database representation aligned with it so PostgreSQL cannot drift
-- back to the historical 15-stage model.
INSERT INTO v2_1.stage_definitions(stage, sequence_no, terminal) VALUES
('SIGNAL',1,false),('IDEA',2,false),('BRIEF',3,false),('RESEARCH',4,false),
('BIBLE',5,false),('CONCEPT',6,false),('SCRIPT',7,false),('SHOT_PLAN',8,false),
('ASSET_PLAN',9,false),('ASSETS',10,false),('EDIT',11,false),('MASTER',12,false),
('OBJECTIVE_QA',13,false),('HUMAN_APPROVAL',14,false),('DELIVERY',15,false),
('DELIVERY_QA',16,false),('PUBLISH',17,false),('ANALYZE',18,false),('LEARN',19,true)
ON CONFLICT(stage) DO UPDATE
SET sequence_no=EXCLUDED.sequence_no, terminal=EXCLUDED.terminal;

DELETE FROM v2_1.stage_definitions
WHERE stage NOT IN (
  'SIGNAL','IDEA','BRIEF','RESEARCH','BIBLE','CONCEPT','SCRIPT','SHOT_PLAN',
  'ASSET_PLAN','ASSETS','EDIT','MASTER','OBJECTIVE_QA','HUMAN_APPROVAL',
  'DELIVERY','DELIVERY_QA','PUBLISH','ANALYZE','LEARN'
);

COMMIT;
