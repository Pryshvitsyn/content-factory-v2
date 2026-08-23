BEGIN;

-- V2.4 local compatibility bridge for legacy V2.1 databases.
-- PostgreSQL does not allow CREATE OR REPLACE FUNCTION to change a function's
-- return type. Older local V2.1 snapshots may contain these execution helpers
-- with pre-canonical return signatures. Drop only the helper functions that
-- 002_v2_1_execution.sql immediately recreates in canonical form.
-- No tables or user data are modified here.

DROP FUNCTION IF EXISTS v2_1.claim_job(text, integer);
DROP FUNCTION IF EXISTS v2_1.claim_job_for_production(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS v2_1.heartbeat_job(uuid, text, integer);
DROP FUNCTION IF EXISTS v2_1.claim_stage(uuid, text, integer);
DROP FUNCTION IF EXISTS v2_1.heartbeat_stage(uuid, text, integer);

COMMIT;
