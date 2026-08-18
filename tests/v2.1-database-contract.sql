-- V2.1 database contract assertions.
-- Run against content_os after migrations/001_v2.sql, 002_v2_1_execution.sql
-- and 003_v2_1_execution_contract_fix.sql.

DO $$
DECLARE
  expected text[] := ARRAY[
    'SIGNAL','IDEA','BRIEF','BIBLE','CONCEPT','SCRIPT','SHOT_PLAN',
    'ASSET_PLAN','ASSETS','EDIT','PLATFORM_ADAPTATION','VALIDATION',
    'PUBLISH','ANALYZE','LEARN'
  ];
  actual text[];
BEGIN
  IF to_regnamespace('v2_1') IS NULL THEN RAISE EXCEPTION 'v2_1 schema is missing'; END IF;
  IF to_regclass('v2_1.productions') IS NULL THEN RAISE EXCEPTION 'v2_1.productions is missing'; END IF;
  IF to_regclass('v2_1.jobs') IS NULL THEN RAISE EXCEPTION 'v2_1.jobs is missing'; END IF;
  IF to_regclass('v2_1.stage_runs') IS NULL THEN RAISE EXCEPTION 'v2_1.stage_runs is missing'; END IF;
  IF to_regclass('v2_1.stage_definitions') IS NULL THEN RAISE EXCEPTION 'v2_1.stage_definitions is missing'; END IF;

  IF to_regprocedure('v2_1.claim_job(text,integer)') IS NULL THEN RAISE EXCEPTION 'claim_job(text,integer) is missing'; END IF;
  IF to_regprocedure('v2_1.claim_job_for_production(uuid,uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'claim_job_for_production signature is missing'; END IF;
  IF to_regprocedure('v2_1.heartbeat_job(uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'heartbeat_job signature is missing'; END IF;
  IF to_regprocedure('v2_1.claim_stage(uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'claim_stage signature is missing'; END IF;
  IF to_regprocedure('v2_1.heartbeat_stage(uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'heartbeat_stage signature is missing'; END IF;
  IF to_regprocedure('v2_1.recover_expired_work()') IS NULL THEN RAISE EXCEPTION 'recover_expired_work signature is missing'; END IF;

  SELECT array_agg(stage ORDER BY sequence_no) INTO actual FROM v2_1.stage_definitions;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Stage contract mismatch. Expected %, got %', expected, actual;
  END IF;

  IF (SELECT count(*) FROM v2_1.stage_definitions WHERE terminal) <> 1
     OR NOT EXISTS (SELECT 1 FROM v2_1.stage_definitions WHERE stage='LEARN' AND terminal) THEN
    RAISE EXCEPTION 'LEARN must be the only terminal stage';
  END IF;
END $$;

-- Lease ownership must be represented explicitly; these columns are the
-- database-level concurrency contract used by the worker.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='jobs' AND column_name='worker_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='jobs' AND column_name='lease_expires_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='stage_runs' AND column_name='worker_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='stage_runs' AND column_name='lease_expires_at') THEN
    RAISE EXCEPTION 'Lease ownership columns are incomplete';
  END IF;
END $$;
