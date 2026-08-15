-- V2.1 real generation vertical slice: IDEA -> NVIDIA -> artifact provenance.
-- Provider credentials never enter the database.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check CHECK (
    artifact_type IN (
      'IDEA_SET','SCRIPT','PRODUCTION_BIBLE','REFERENCE_IMAGE','IMAGE','VIDEO',
      'VOICE','AUDIO','MUSIC','CAPTIONS','EDIT','FINAL_VIDEO','THUMBNAIL'
    )
  );

ALTER TABLE v2_1.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_request_hash_key;

ALTER TABLE v2_1.generation_runs
  ADD COLUMN IF NOT EXISTS artifact_id uuid REFERENCES v2_1.artifacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_generation_active_request
  ON v2_1.generation_runs(request_hash)
  WHERE status IN ('QUEUED','RUNNING','COMPLETED');

CREATE INDEX IF NOT EXISTS idx_v21_generation_stage_status
  ON v2_1.generation_runs(stage_run_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_v21_generation_artifact
  ON v2_1.generation_runs(artifact_id);

COMMENT ON COLUMN v2_1.generation_runs.request_hash IS
  'Deterministic hash of the complete provider-independent generation request; active/completed requests are unique while failed attempts remain auditable.';
COMMENT ON COLUMN v2_1.generation_runs.artifact_id IS
  'Immutable logical artifact produced by this generation run; provider execution remains separate from creative truth.';
