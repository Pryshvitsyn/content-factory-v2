
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- V2 build journal: makes the migration itself resumable/idempotent.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factory_v2_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_key text NOT NULL UNIQUE,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  current_phase text,
  backup_path text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ------------------------------------------------------------------
-- One pipeline/job, many deterministic stages.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid,
  source_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  idempotency_key text,
  status text NOT NULL DEFAULT 'draft',
  current_stage text,
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workspace ON pipeline_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS idempotency_key text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='uq_pipeline_runs_workspace_idempotency'
  ) THEN
    ALTER TABLE pipeline_runs
      ADD CONSTRAINT uq_pipeline_runs_workspace_idempotency
      UNIQUE(workspace_id,idempotency_key);
  END IF;
END $$;


CREATE TABLE IF NOT EXISTS job_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  sequence_no integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  input_artifact_id uuid,
  output_artifact_id uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  started_at timestamptz,
  completed_at timestamptz,
  locked_at timestamptz,
  error_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (pipeline_run_id, stage_key),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_job_stages_status ON job_stages(status);
CREATE INDEX IF NOT EXISTS idx_job_stages_pipeline ON job_stages(pipeline_run_id);

-- ------------------------------------------------------------------
-- Immutable artifact history. Nothing overwrites an artifact version.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES job_stages(id) ON DELETE SET NULL,
  artifact_type text NOT NULL,
  logical_key text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  content_json jsonb,
  content_text text,
  uri text,
  sha256 text,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, logical_key, version)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_pipeline ON artifacts(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type_key ON artifacts(workspace_id, artifact_type, logical_key);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

-- ------------------------------------------------------------------
-- Every provider attempt is auditable.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES job_stages(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_json jsonb,
  error_data jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(stage_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_stage_attempts_stage ON stage_attempts(stage_id);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES job_stages(id) ON DELETE SET NULL,
  source_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  requeued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_created ON dead_letter_jobs(created_at);

-- ------------------------------------------------------------------
-- Provider capability registry for future image/video/audio adapters.
-- Existing ai_providers/ai_models remain the source of provider identity.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(provider_id, capability)
);

-- ------------------------------------------------------------------
-- Canonical continuity state. Character/location rows remain the
-- existing source of truth; these snapshots freeze the state used by
-- each script/scene/shot so later generations cannot silently drift.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS continuity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  script_id uuid REFERENCES scripts(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES scenes(id) ON DELETE CASCADE,
  shot_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_name text NOT NULL,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_continuity_script ON continuity_snapshots(script_id);
CREATE INDEX IF NOT EXISTS idx_continuity_scene ON continuity_snapshots(scene_id);

-- ------------------------------------------------------------------
-- Shot plan. Keep/create the table if the previous V2 prototype
-- migration was already applied.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  shot_number integer NOT NULL,
  shot_type text,
  purpose text,
  duration_seconds numeric(8,2),
  characters jsonb NOT NULL DEFAULT '[]'::jsonb,
  action text,
  dialogue text,
  voiceover text,
  visual_prompt text,
  camera_prompt text,
  lighting_prompt text,
  motion_prompt text,
  audio_prompt text,
  continuity jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'planned',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scene_id, shot_number)
);

CREATE INDEX IF NOT EXISTS idx_shots_script ON shots(script_id);
CREATE INDEX IF NOT EXISTS idx_shots_scene ON shots(scene_id);
CREATE INDEX IF NOT EXISTS idx_shots_status ON shots(status);

-- Extend existing scene records without breaking them.
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS motion_prompt text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS continuity jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing asset requirements become provider-ready.
CREATE TABLE IF NOT EXISTS asset_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  script_id uuid REFERENCES scripts(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES scenes(id) ON DELETE CASCADE,
  shot_id uuid REFERENCES shots(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned',
  idempotency_key text,
  prompt text,
  negative_prompt text,
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_asset_requirements_status ON asset_requirements(status);
CREATE INDEX IF NOT EXISTS idx_asset_requirements_shot ON asset_requirements(shot_id);
ALTER TABLE asset_requirements ADD COLUMN IF NOT EXISTS idempotency_key text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='uq_asset_requirements_idempotency'
  ) THEN
    ALTER TABLE asset_requirements
      ADD CONSTRAINT uq_asset_requirements_idempotency
      UNIQUE(idempotency_key);
  END IF;
END $$;


CREATE TABLE IF NOT EXISTS validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid REFERENCES job_stages(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES artifacts(id) ON DELETE CASCADE,
  validation_type text NOT NULL,
  status text NOT NULL,
  score numeric(6,3),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_validation_stage ON validation_results(stage_id);

-- ------------------------------------------------------------------
-- Status constraints. Drop/recreate so this is safe after the
-- previous prototype migration.
-- ------------------------------------------------------------------
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_generation_jobs_idempotency ON generation_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Recover workers that died while holding a job.
UPDATE generation_jobs
SET status='retrying', next_attempt_at=now()
WHERE status='running' AND started_at < now() - interval '30 minutes';

ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
CHECK (status IN ('queued','running','completed','failed','cancelled','retrying','dead_letter'));

ALTER TABLE pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_status_check
CHECK (status IN ('draft','running','waiting_approval','completed','failed','cancelled','dead_letter'));

ALTER TABLE job_stages DROP CONSTRAINT IF EXISTS job_stages_status_check;
ALTER TABLE job_stages ADD CONSTRAINT job_stages_status_check
CHECK (status IN ('pending','queued','running','completed','failed','retrying','dead_letter','skipped'));


-- ------------------------------------------------------------------
-- Existing scripts become immutable V2 artifacts. The legacy script
-- remains untouched; this is a historical projection, not a rewrite.
-- ------------------------------------------------------------------
INSERT INTO artifacts (
  workspace_id, pipeline_run_id, stage_id, artifact_type, logical_key,
  version, status, content_text, sha256, provider_id, model_id, metadata
)
SELECT
  gj.workspace_id,
  pr.id,
  js.id,
  'script',
  'script:' || s.id::text,
  s.version,
  'active',
  s.script_text,
  encode(digest(coalesce(s.script_text,''), 'sha256'), 'hex'),
  gj.provider_id,
  gj.model_id,
  jsonb_build_object(
    'legacy_script_id', s.id,
    'legacy_concept_id', s.concept_id,
    'migrated_by', 'content-factory-v2'
  )
FROM scripts s
JOIN LATERAL (
  SELECT g.*
  FROM generation_jobs g
  WHERE g.input_data->>'concept_id'=s.concept_id::text
  ORDER BY g.created_at DESC
  LIMIT 1
) gj ON true
LEFT JOIN pipeline_runs pr ON pr.source_job_id=gj.id
LEFT JOIN job_stages js ON js.pipeline_run_id=pr.id AND js.stage_key='script'
WHERE NOT EXISTS (
  SELECT 1 FROM artifacts a
  WHERE a.logical_key='script:' || s.id::text
);

INSERT INTO artifact_versions(artifact_id,version,sha256)
SELECT a.id,a.version,a.sha256
FROM artifacts a
WHERE a.logical_key LIKE 'script:%'
  AND NOT EXISTS (
    SELECT 1 FROM artifact_versions av
    WHERE av.artifact_id=a.id AND av.version=a.version
  );

-- ------------------------------------------------------------------
-- Provider registration. NVIDIA remains first for text generation.
-- If the existing row exists, do not replace its model ID/config.
-- ------------------------------------------------------------------
INSERT INTO provider_capabilities(provider_id, capability, priority)
SELECT p.id, 'text_generation', 10
FROM ai_providers p
WHERE p.slug = 'nvidia'
ON CONFLICT (provider_id, capability) DO UPDATE
SET enabled = true, priority = LEAST(provider_capabilities.priority, 10);

INSERT INTO provider_capabilities(provider_id, capability, priority)
SELECT p.id, capability, 20
FROM ai_providers p
CROSS JOIN (VALUES
  ('image_generation'),
  ('video_generation'),
  ('audio_generation'),
  ('text_to_speech')
) v(capability)
WHERE p.slug = 'nvidia'
ON CONFLICT (provider_id, capability) DO NOTHING;

-- ------------------------------------------------------------------
-- Migrate existing queued/running jobs into pipeline_runs/stages.
-- Completed legacy jobs remain untouched; a completed stage record is
-- created so V2 has historical visibility.
-- ------------------------------------------------------------------
INSERT INTO pipeline_runs (
  workspace_id, source_job_id, idempotency_key, status,
  current_stage, input_data, output_data, error_data,
  started_at, completed_at
)
SELECT
  g.workspace_id,
  g.id,
  'legacy-job:' || g.id::text,
  CASE
    WHEN g.status = 'completed' THEN 'completed'
    WHEN g.status IN ('failed','dead_letter') THEN 'failed'
    WHEN g.status = 'cancelled' THEN 'cancelled'
    ELSE 'running'
  END,
  CASE
    WHEN g.job_type = 'script_generation' THEN 'script'
    WHEN g.job_type = 'production_planning' THEN 'production_bible'
    ELSE g.job_type
  END,
  g.input_data,
  g.output_data,
  g.error_data,
  g.started_at,
  g.completed_at
FROM generation_jobs g
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_runs p
  WHERE p.idempotency_key = 'legacy-job:' || g.id::text
);

INSERT INTO job_stages (
  pipeline_run_id,
  stage_key,
  sequence_no,
  status,
  idempotency_key,
  attempt_count,
  max_attempts,
  started_at,
  completed_at,
  error_data
)
SELECT
  p.id,
  CASE
    WHEN g.job_type = 'script_generation' THEN 'script'
    WHEN g.job_type = 'production_planning' THEN 'production_bible'
    ELSE g.job_type
  END,
  CASE
    WHEN g.job_type = 'script_generation' THEN 20
    WHEN g.job_type = 'production_planning' THEN 30
    ELSE 10
  END,
  CASE
    WHEN g.status = 'completed' THEN 'completed'
    WHEN g.status IN ('failed','dead_letter') THEN 'failed'
    WHEN g.status = 'cancelled' THEN 'skipped'
    ELSE 'running'
  END,
  'legacy-stage:' || g.id::text,
  g.attempts,
  g.max_attempts,
  g.started_at,
  g.completed_at,
  g.error_data
FROM generation_jobs g
JOIN LATERAL (
  SELECT pr.id
  FROM pipeline_runs pr
  WHERE pr.source_job_id = g.id
  ORDER BY pr.id DESC
  LIMIT 1
) p ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM job_stages s
  WHERE s.idempotency_key = 'legacy-stage:' || g.id::text
     OR (
       s.pipeline_run_id = p.id
       AND s.stage_key = CASE
         WHEN g.job_type = 'script_generation' THEN 'script'
         WHEN g.job_type = 'production_planning' THEN 'production_bible'
         ELSE g.job_type
       END
     )
);

COMMIT;
