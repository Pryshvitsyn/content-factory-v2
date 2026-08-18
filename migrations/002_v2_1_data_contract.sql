BEGIN;

-- V2.1 data-contract hardening.
-- This migration intentionally does NOT modify worker execution functions,
-- claim/lease logic, or PostgreSQL certification procedures.

-- Helper pattern: constraints are added only when absent so the migration
-- remains safe to re-run during development/recovery.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_stages_sequence_positive') THEN
    ALTER TABLE job_stages ADD CONSTRAINT job_stages_sequence_positive CHECK (sequence_no > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_stages_attempt_count_nonnegative') THEN
    ALTER TABLE job_stages ADD CONSTRAINT job_stages_attempt_count_nonnegative CHECK (attempt_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_stages_max_attempts_positive') THEN
    ALTER TABLE job_stages ADD CONSTRAINT job_stages_max_attempts_positive CHECK (max_attempts > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stage_attempts_attempt_no_positive') THEN
    ALTER TABLE stage_attempts ADD CONSTRAINT stage_attempts_attempt_no_positive CHECK (attempt_no > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='artifacts_version_positive') THEN
    ALTER TABLE artifacts ADD CONSTRAINT artifacts_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='artifact_versions_version_positive') THEN
    ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_capabilities_priority_nonnegative') THEN
    ALTER TABLE provider_capabilities ADD CONSTRAINT provider_capabilities_priority_nonnegative CHECK (priority >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='asset_requirements_attempts_nonnegative') THEN
    ALTER TABLE asset_requirements ADD CONSTRAINT asset_requirements_attempts_nonnegative CHECK (attempts >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='asset_requirements_max_attempts_positive') THEN
    ALTER TABLE asset_requirements ADD CONSTRAINT asset_requirements_max_attempts_positive CHECK (max_attempts > 0);
  END IF;
END $$;

-- A pipeline cannot contain two stages at the same execution position.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_job_stages_pipeline_sequence') THEN
    ALTER TABLE job_stages
      ADD CONSTRAINT uq_job_stages_pipeline_sequence UNIQUE (pipeline_run_id, sequence_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_artifacts_stage ON artifacts(stage_id);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id);

-- Validation is attached to an immutable artifact version. The column is
-- nullable initially because legacy validation rows may only know artifact_id.
ALTER TABLE validation_results
  ADD COLUMN IF NOT EXISTS artifact_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'validation_results_artifact_version_fk'
  ) THEN
    ALTER TABLE validation_results
      ADD CONSTRAINT validation_results_artifact_version_fk
      FOREIGN KEY (artifact_version_id)
      REFERENCES artifact_versions(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'validation_results_score_range'
  ) THEN
    ALTER TABLE validation_results
      ADD CONSTRAINT validation_results_score_range
      CHECK (score IS NULL OR (score >= 0 AND score <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_validation_artifact_version
  ON validation_results(artifact_version_id);

-- Deterministic provider selection and execution-history lookups.
CREATE INDEX IF NOT EXISTS idx_provider_capabilities_selection
  ON provider_capabilities(capability, enabled, priority, provider_id);

CREATE INDEX IF NOT EXISTS idx_job_stages_scheduler
  ON job_stages(status, pipeline_run_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_stage_attempts_stage_attempt
  ON stage_attempts(stage_id, attempt_no DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_logical_latest
  ON artifacts(workspace_id, logical_key, version DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_latest
  ON artifact_versions(artifact_id, version DESC);

-- Canonical stage vocabulary. This is a registry for validation/design;
-- it does not change the worker execution sequence.
CREATE TABLE IF NOT EXISTS stage_definitions (
  stage_key text PRIMARY KEY,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO stage_definitions(stage_key, sequence_no, description) VALUES
  ('script', 20, 'Create or revise the canonical script artifact'),
  ('production_bible', 30, 'Create production-wide creative and continuity plan'),
  ('shots', 40, 'Create deterministic shot plan'),
  ('assets', 50, 'Resolve and/or generate required assets'),
  ('video', 60, 'Generate or assemble final video output'),
  ('validation', 70, 'Validate final production outputs')
ON CONFLICT (stage_key) DO UPDATE
SET sequence_no = EXCLUDED.sequence_no,
    description = EXCLUDED.description;

COMMIT;
