-- V2.4 deterministic bridge from legacy Content OS / early V2.1 layouts.
--
-- This migration is intentionally separate from certified historical migrations.
-- It preserves rows, adds the canonical columns used by V2.1-V2.4, relaxes only
-- explicitly obsolete legacy write requirements, and enforces canonical rules on
-- every new row. It is safe to run before and after the V2.1/V2.2 migrations.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS v2_1;

-- CREATE TABLE IF NOT EXISTS does not evolve legacy tables. Add only the
-- canonical columns needed by current execution and control-plane contracts.
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS brand_id uuid;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS status text DEFAULT 'DRAFT';
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.productions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS production_id uuid;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS generation_job_id uuid;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS status text DEFAULT 'QUEUED';
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE IF EXISTS v2_1.jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDING';
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS input_artifacts jsonb DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS output_artifacts jsonb DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS input_fingerprint text;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS output_fingerprint text;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE IF EXISTS v2_1.stage_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE IF EXISTS v2_1.stage_definitions ADD COLUMN IF NOT EXISTS sequence_no integer;
ALTER TABLE IF EXISTS v2_1.stage_definitions ADD COLUMN IF NOT EXISTS terminal boolean DEFAULT false;
ALTER TABLE IF EXISTS v2_1.stage_definitions ADD COLUMN IF NOT EXISTS retryable boolean DEFAULT true;
ALTER TABLE IF EXISTS v2_1.concurrency_certifications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS production_id uuid;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS asset_id text;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS semantic_key text;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS artifact_storage_key text;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS artifact_version integer;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS status text DEFAULT 'READY';
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.asset_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS artifact_version_id uuid;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS publication_key text;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDING';
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE IF EXISTS v2_1.publications ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- These columns belong to obsolete legacy creation contracts. Current V2.1
-- creates a production without content_variant_id and a publication without
-- edition_id/platform. Dropping NOT NULL preserves every historical value and
-- only removes the obsolete requirement from future canonical inserts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='productions' AND column_name='content_variant_id') THEN
    ALTER TABLE v2_1.productions ALTER COLUMN content_variant_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='publications' AND column_name='edition_id') THEN
    ALTER TABLE v2_1.publications ALTER COLUMN edition_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='publications' AND column_name='platform') THEN
    ALTER TABLE v2_1.publications ALTER COLUMN platform DROP NOT NULL;
  END IF;
END $$;

-- Remove only incompatible helper signatures. The immediately following
-- certified V2.1 migrations recreate the missing functions canonically.
DO $$
DECLARE item record; actual text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('v2_1.claim_job(text,integer)', 'SETOF v2_1.jobs'),
    ('v2_1.claim_job_for_production(uuid,uuid,text,integer)', 'SETOF v2_1.jobs'),
    ('v2_1.heartbeat_job(uuid,text,integer)', 'boolean'),
    ('v2_1.claim_stage(uuid,text,integer)', 'SETOF v2_1.stage_runs'),
    ('v2_1.heartbeat_stage(uuid,text,integer)', 'boolean')
  ) AS expected(signature, result_type)
  LOOP
    IF to_regprocedure(item.signature) IS NOT NULL THEN
      SELECT pg_get_function_result(to_regprocedure(item.signature)) INTO actual;
      IF regexp_replace(lower(actual), '\s+', '', 'g') <> regexp_replace(lower(item.result_type), '\s+', '', 'g') THEN
        EXECUTE 'DROP FUNCTION ' || item.signature;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Legacy status checks can reject canonical values such as PENDING and
-- DEAD_LETTER. Replace only table-level status checks with an explicit union:
-- historical values remain readable/updatable and canonical values are
-- enforced for all new rows.
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('v2_1.jobs') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.jobs'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) LIKE '%''DEAD_LETTER''%') THEN
      FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='v2_1.jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mstatus\M'
      LOOP EXECUTE format('ALTER TABLE v2_1.jobs DROP CONSTRAINT %I', r.conname); END LOOP;
      ALTER TABLE v2_1.jobs ADD CONSTRAINT jobs_v24_status_check
        CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED','RETRYING','DEAD_LETTER')) NOT VALID;
    END IF;
  END IF;
  IF to_regclass('v2_1.stage_runs') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.stage_runs'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) LIKE '%''PENDING''%'
      AND pg_get_constraintdef(oid) LIKE '%''DEAD_LETTER''%' AND pg_get_constraintdef(oid) LIKE '%''SKIPPED''%') THEN
      FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='v2_1.stage_runs'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mstatus\M'
      LOOP EXECUTE format('ALTER TABLE v2_1.stage_runs DROP CONSTRAINT %I', r.conname); END LOOP;
      ALTER TABLE v2_1.stage_runs ADD CONSTRAINT stage_runs_v24_status_check
        CHECK (status IN ('QUEUED','PENDING','RUNNING','COMPLETED','FAILED','CANCELLED','RETRYING','DEAD_LETTER','SKIPPED')) NOT VALID;
    END IF;
  END IF;
  IF to_regclass('v2_1.publications') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.publications'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) LIKE '%''PENDING''%'
      AND pg_get_constraintdef(oid) LIKE '%''PUBLISHING''%') THEN
      FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='v2_1.publications'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mstatus\M'
      LOOP EXECUTE format('ALTER TABLE v2_1.publications DROP CONSTRAINT %I', r.conname); END LOOP;
      ALTER TABLE v2_1.publications ADD CONSTRAINT publications_v24_status_check
        CHECK (status IN ('DRAFT','SCHEDULED','PENDING','PUBLISHING','PUBLISHED','FAILED','CANCELLED','UNKNOWN')) NOT VALID;
    END IF;
  END IF;
  IF to_regclass('v2_1.asset_registry') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.asset_registry'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) LIKE '%''READY''%'
      AND pg_get_constraintdef(oid) LIKE '%''INVALID''%' AND pg_get_constraintdef(oid) LIKE '%''ARCHIVED''%') THEN
      FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='v2_1.asset_registry'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mstatus\M'
      LOOP EXECUTE format('ALTER TABLE v2_1.asset_registry DROP CONSTRAINT %I', r.conname); END LOOP;
      ALTER TABLE v2_1.asset_registry ADD CONSTRAINT asset_registry_v24_status_check
        CHECK (status IN ('READY','INVALID','ARCHIVED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.asset_registry'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\martifact_version\M') THEN
      ALTER TABLE v2_1.asset_registry ADD CONSTRAINT asset_registry_v24_artifact_version_check
        CHECK (artifact_version > 0) NOT VALID;
    END IF;
  END IF;
END $$;

-- Fail with a deterministic explanation instead of discovering duplicate-key
-- incompatibility during a paid run.
DO $$
BEGIN
  IF to_regclass('v2_1.productions') IS NOT NULL AND EXISTS (
    SELECT 1 FROM v2_1.productions WHERE workspace_id IS NOT NULL AND name IS NOT NULL
    GROUP BY workspace_id,name HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'V2.4 compatibility blocked: duplicate productions(workspace_id,name)'; END IF;
  IF to_regclass('v2_1.jobs') IS NOT NULL AND EXISTS (
    SELECT 1 FROM v2_1.jobs WHERE production_id IS NOT NULL AND idempotency_key IS NOT NULL
    GROUP BY production_id,idempotency_key HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'V2.4 compatibility blocked: duplicate jobs(production_id,idempotency_key)'; END IF;
  IF to_regclass('v2_1.stage_runs') IS NOT NULL AND EXISTS (
    SELECT 1 FROM v2_1.stage_runs WHERE job_id IS NOT NULL AND stage IS NOT NULL AND attempt IS NOT NULL
    GROUP BY job_id,stage,attempt HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'V2.4 compatibility blocked: duplicate stage_runs(job_id,stage,attempt)'; END IF;
  IF to_regclass('v2_1.asset_registry') IS NOT NULL AND EXISTS (
    SELECT 1 FROM v2_1.asset_registry WHERE production_id IS NOT NULL AND asset_id IS NOT NULL
    GROUP BY production_id,asset_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'V2.4 compatibility blocked: duplicate asset_registry(production_id,asset_id)'; END IF;
  IF to_regclass('v2_1.publications') IS NOT NULL AND EXISTS (
    SELECT 1 FROM v2_1.publications WHERE publication_key IS NOT NULL
    GROUP BY publication_key HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'V2.4 compatibility blocked: duplicate publications(publication_key)'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('v2_1.productions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid
      WHERE n.nspname='v2_1' AND i.relname='uq_v21_productions_workspace_name' AND x.indpred IS NOT NULL) THEN
      DROP INDEX v2_1.uq_v21_productions_workspace_name;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_productions_workspace_name
      ON v2_1.productions(workspace_id,name);
  END IF;
  IF to_regclass('v2_1.jobs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid
      WHERE n.nspname='v2_1' AND i.relname='uq_v21_jobs_production_idempotency' AND x.indpred IS NOT NULL) THEN
      DROP INDEX v2_1.uq_v21_jobs_production_idempotency;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_jobs_production_idempotency
      ON v2_1.jobs(production_id,idempotency_key);
  END IF;
  IF to_regclass('v2_1.stage_runs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid
      WHERE n.nspname='v2_1' AND i.relname='uq_v21_stage_runs_job_stage_attempt' AND x.indpred IS NOT NULL) THEN
      DROP INDEX v2_1.uq_v21_stage_runs_job_stage_attempt;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_stage_runs_job_stage_attempt
      ON v2_1.stage_runs(job_id,stage,attempt);
  END IF;
  IF to_regclass('v2_1.asset_registry') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid
      WHERE n.nspname='v2_1' AND i.relname='uq_v21_asset_registry_production_asset' AND x.indpred IS NOT NULL) THEN
      DROP INDEX v2_1.uq_v21_asset_registry_production_asset;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_asset_registry_production_asset
      ON v2_1.asset_registry(production_id,asset_id);
  END IF;
  IF to_regclass('v2_1.publications') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid
      WHERE n.nspname='v2_1' AND i.relname='uq_v21_publications_publication_key' AND x.indpred IS NOT NULL) THEN
      DROP INDEX v2_1.uq_v21_publications_publication_key;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_publications_publication_key
      ON v2_1.publications(publication_key);
  END IF;
END $$;

-- Add ownership FKs as NOT VALID first. PostgreSQL enforces them for all new
-- rows while allowing unrelated legacy rows to remain intact.
DO $$
BEGIN
  IF to_regclass('v2_1.productions') IS NOT NULL AND to_regclass('public.workspaces') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.productions'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id)%') THEN
    ALTER TABLE v2_1.productions ADD CONSTRAINT productions_v24_workspace_fk
      FOREIGN KEY(workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF to_regclass('v2_1.jobs') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.jobs'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (production_id) REFERENCES v2_1.productions(id)%') THEN
    ALTER TABLE v2_1.jobs ADD CONSTRAINT jobs_v24_production_fk
      FOREIGN KEY(production_id) REFERENCES v2_1.productions(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF to_regclass('v2_1.stage_runs') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.stage_runs'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (job_id) REFERENCES v2_1.jobs(id)%') THEN
    ALTER TABLE v2_1.stage_runs ADD CONSTRAINT stage_runs_v24_job_fk
      FOREIGN KEY(job_id) REFERENCES v2_1.jobs(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF to_regclass('v2_1.asset_registry') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='v2_1.asset_registry'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (production_id) REFERENCES v2_1.productions(id)%') THEN
    ALTER TABLE v2_1.asset_registry ADD CONSTRAINT asset_registry_v24_production_fk
      FOREIGN KEY(production_id) REFERENCES v2_1.productions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- Canonical brand ownership is v2_2.brands. Drop only FKs on brand_id that
-- point elsewhere; never delete or rewrite a production/brand row.
DO $$
DECLARE r record; canonical_name text;
BEGIN
  IF to_regclass('v2_1.productions') IS NULL OR to_regclass('v2_2.brands') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT con.conname, rn.nspname AS ref_schema, rc.relname AS ref_table
    FROM pg_constraint con
    JOIN pg_class rc ON rc.oid=con.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=ANY(con.conkey)
    WHERE con.conrelid='v2_1.productions'::regclass AND con.contype='f' AND a.attname='brand_id'
  LOOP
    IF r.ref_schema <> 'v2_2' OR r.ref_table <> 'brands' THEN
      EXECUTE format('ALTER TABLE v2_1.productions DROP CONSTRAINT %I', r.conname);
    ELSE canonical_name := r.conname;
    END IF;
  END LOOP;
  IF canonical_name IS NULL THEN
    ALTER TABLE v2_1.productions ADD CONSTRAINT productions_v24_brand_fk
      FOREIGN KEY(brand_id) REFERENCES v2_2.brands(id) ON DELETE RESTRICT NOT VALID;
    canonical_name := 'productions_v24_brand_fk';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2_1.productions p LEFT JOIN v2_2.brands b ON b.id=p.brand_id
    WHERE p.brand_id IS NOT NULL AND b.id IS NULL
  ) THEN
    EXECUTE format('ALTER TABLE v2_1.productions VALIDATE CONSTRAINT %I', canonical_name);
  END IF;
END $$;

COMMIT;
