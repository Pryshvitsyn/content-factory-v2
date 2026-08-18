BEGIN;

-- V2.1 data-contract hardening.
-- This migration intentionally does NOT modify worker execution functions,
-- claim/lease logic, or PostgreSQL certification procedures.

-- 1. Basic numeric integrity: the database must reject impossible values.
ALTER TABLE job_stages
  ADD CONSTRAINT job_stages_sequence_positive CHECK (sequence_no > 0),
  ADD CONSTRAINT job_stages_attempt_count_nonnegative CHECK (attempt_count >= 0),
  ADD CONSTRAINT job_stages_max_attempts_positive CHECK (max_attempts > 0);

ALTER TABLE stage_attempts
  ADD CONSTRAINT stage_attempts_attempt_no_positive CHECK (attempt_no > 0);

ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_version_positive CHECK (version > 0);

ALTER TABLE artifact_versions
  ADD CONSTRAINT artifact_versions_version_positive CHECK (version > 0);

ALTER TABLE provider_capabilities
  ADD CONSTRAINT provider_capabilities_priority_nonnegative CHECK (priority >= 0);

ALTER TABLE asset_requirements
  ADD CONSTRAINT asset_requirements_attempts_nonnegative CHECK (attempts >= 0),
  ADD CONSTRAINT asset_requirements_max_attempts_positive CHECK (max_attempts > 0);

-- 2. A pipeline cannot contain two stages at the same execution position.
ALTER TABLE job_stages
  ADD CONSTRAINT uq_job_stages_pipeline_sequence
  UNIQUE (pipeline_run_id, sequence_no);

-- 3. A logical artifact belongs to one canonical stage/pipeline context.
-- Keep the existing nullable relationships for legacy/historical rows.
CREATE INDEX IF NOT EXISTS idx_artifacts_stage ON artifacts(stage_id);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id);

-- 4. Validation is about an immutable artifact version, not merely the
-- logical artifact. The column is initially nullable for legacy rows and
-- can be made mandatory after historical validation rows are projected.
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
END $$;

CREATE INDEX IF NOT EXISTS idx_validation_artifact_version
  ON validation_results(artifact_version_id);

-- 5. Validation records should be safely classifiable.
ALTER TABLE validation_results
  ADD CONSTRAINT validation_results_score_range
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- 6. Provider capability selection needs deterministic lookup support.
CREATE INDEX IF NOT EXISTS idx_provider_capabilities_selection
  ON provider_capabilities(capability, enabled, priority, provider_id);

-- 7. Stage scheduling lookup: status first, then pipeline ordering.
CREATE INDEX IF NOT EXISTS idx_job_stages_scheduler
  ON job_stages(status, pipeline_run_id, sequence_no);

-- 8. Attempt history lookup by stage and newest attempt.
CREATE INDEX IF NOT EXISTS idx_stage_attempts_stage_attempt
  ON stage_attempts(stage_id, attempt_no DESC);

-- 9. Artifact lookup by logical identity and newest version.
CREATE INDEX IF NOT EXISTS idx_artifacts_logical_latest
  ON artifacts(workspace_id, logical_key, version DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_latest
  ON artifact_versions(artifact_id, version DESC);

-- 10. Explicitly document canonical stage vocabulary. This table is a
-- registry, not an execution dependency; new stages can be added deliberately.
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
