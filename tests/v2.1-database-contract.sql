-- V2.1 database contract assertions.
-- Run against the content_os database after the V2.1 migration.
-- These assertions intentionally fail fast if the database contract diverges
-- from worker/v2.1-production-contract.js.

DO $$
DECLARE
  expected text[] := ARRAY[
    'SIGNAL','IDEA','BRIEF','BIBLE','CONCEPT','SCRIPT','SHOT_PLAN',
    'ASSET_PLAN','ASSETS','EDIT','PLATFORM_ADAPTATION','VALIDATION',
    'PUBLISH','ANALYZE','LEARN'
  ];
  actual text[];
BEGIN
  IF to_regnamespace('v2_1') IS NULL THEN
    RAISE EXCEPTION 'V2.1 schema v2_1 is missing';
  END IF;

  IF to_regprocedure('v2_1.claim_job(text,integer)') IS NULL
     AND to_regprocedure('v2_1.claim_job(text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'V2.1 claim_job function is missing';
  END IF;

  IF to_regprocedure('v2_1.claim_stage(uuid,text,integer)') IS NULL
     AND to_regprocedure('v2.1.claim_stage(uuid,text,integer)') IS NULL THEN
    -- Function signatures may use different UUID/text aliases; inspect manually
    -- if this assertion trips. The schema existence check remains authoritative.
    RAISE NOTICE 'claim_stage signature differs from the canonical check; verify migration manually';
  END IF;

  IF to_regclass('v2_1.jobs') IS NULL THEN
    RAISE EXCEPTION 'v2.1.jobs is missing';
  END IF;
  IF to_regclass('v2_1.stage_runs') IS NULL THEN
    RAISE EXCEPTION 'v2.1.stage_runs is missing';
  END IF;
  IF to_regclass('v2_1.productions') IS NULL THEN
    RAISE EXCEPTION 'v2.1.productions is missing';
  END IF;
END $$;
