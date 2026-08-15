-- Content Factory V2.1 foundation
-- Namespace is intentionally isolated from the frozen V2.0.0 schema.
-- This migration defines the contracts for orchestration, reusable creative
-- assets, generation provenance, platform editions, experiments and learning.

CREATE SCHEMA IF NOT EXISTS v2_1;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS v2_1.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES v2_1.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  objective text,
  audience text,
  topic text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES v2_1.contents(id) ON DELETE CASCADE,
  name text NOT NULL,
  hook text,
  angle text,
  cta text,
  target_platform text,
  script_artifact_id uuid,
  experiment_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','PRODUCED','PUBLISHED','ARCHIVED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_variant_id uuid NOT NULL REFERENCES v2_1.content_variants(id) ON DELETE CASCADE,
  production_version integer NOT NULL DEFAULT 1 CHECK (production_version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_variant_id, production_version)
);

CREATE TABLE IF NOT EXISTS v2_1.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('CHARACTER','LOCATION','STYLE','VOICE','PROP','BRAND','PRODUCT')),
  name text NOT NULL,
  canonical_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES v2_1.assets(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_artifact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version)
);

CREATE TABLE IF NOT EXISTS v2_1.production_bibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  negative_constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, version)
);

CREATE TABLE IF NOT EXISTS v2_1.production_bible_assets (
  production_bible_id uuid NOT NULL REFERENCES v2_1.production_bibles(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES v2_1.assets(id) ON DELETE RESTRICT,
  role text NOT NULL,
  asset_version_id uuid REFERENCES v2_1.asset_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (production_bible_id, asset_id, role)
);

CREATE TABLE IF NOT EXISTS v2_1.shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  shot_number integer NOT NULL CHECK (shot_number > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0),
  instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','READY','GENERATING','COMPLETED','FAILED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, shot_number)
);

CREATE TABLE IF NOT EXISTS v2_1.asset_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_id uuid NOT NULL REFERENCES v2_1.shots(id) ON DELETE CASCADE,
  asset_role text NOT NULL,
  required_asset_type text NOT NULL,
  required_asset_id uuid REFERENCES v2_1.assets(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING','AVAILABLE','STALE','INVALID','SATISFIED')),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shot_id, asset_role)
);

CREATE TABLE IF NOT EXISTS v2_1.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type text NOT NULL CHECK (artifact_type IN ('SCRIPT','PRODUCTION_BIBLE','REFERENCE_IMAGE','IMAGE','VIDEO','VOICE','AUDIO','MUSIC','CAPTIONS','EDIT','FINAL_VIDEO','THUMBNAIL')),
  asset_id uuid REFERENCES v2_1.assets(id) ON DELETE SET NULL,
  production_id uuid REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','VALIDATING','VALID','INVALID','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES v2_1.artifacts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  provider_id uuid,
  model_id uuid,
  prompt_version_id uuid,
  input_hash text,
  output_hash text,
  storage_uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

CREATE TABLE IF NOT EXISTS v2_1.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES v2_1.providers(id) ON DELETE CASCADE,
  name text NOT NULL,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, name)
);

ALTER TABLE v2_1.artifact_versions
  ADD CONSTRAINT artifact_versions_provider_fk FOREIGN KEY (provider_id) REFERENCES v2_1.providers(id) ON DELETE SET NULL;
ALTER TABLE v2_1.artifact_versions
  ADD CONSTRAINT artifact_versions_model_fk FOREIGN KEY (model_id) REFERENCES v2_1.models(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS v2_1.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','RETRYING','CANCELLED')),
  priority integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS v2_1.stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES v2_1.jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','RETRYING','CANCELLED')),
  input_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (job_id, stage, attempt)
);

CREATE TABLE IF NOT EXISTS v2_1.generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id uuid REFERENCES v2_1.stage_runs(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES v2_1.providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES v2_1.models(id) ON DELETE SET NULL,
  capability text NOT NULL,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  response jsonb,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (request_hash)
);

CREATE TABLE IF NOT EXISTS v2_1.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  template text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS v2_1.editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('TIKTOK','INSTAGRAM_REELS','YOUTUBE_SHORTS','YOUTUBE')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_id uuid REFERENCES v2_1.artifacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, platform, version)
);

CREATE TABLE IF NOT EXISTS v2_1.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hypothesis text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RUNNING','COMPLETED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE v2_1.content_variants
  ADD CONSTRAINT content_variants_experiment_fk FOREIGN KEY (experiment_id) REFERENCES v2_1.experiments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS v2_1.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES v2_1.editions(id) ON DELETE CASCADE,
  platform text NOT NULL,
  account_ref text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','FAILED','CANCELLED')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_ref, external_id)
);

CREATE TABLE IF NOT EXISTS v2_1.performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES v2_1.publications(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  views bigint,
  watch_time_ms bigint,
  retention numeric,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  clicks bigint,
  conversions bigint,
  raw_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS v2_1.learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES v2_1.projects(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  pattern jsonb NOT NULL,
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_1.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v21_contents_project ON v2_1.contents(project_id);
CREATE INDEX IF NOT EXISTS idx_v21_variants_content ON v2_1.content_variants(content_id);
CREATE INDEX IF NOT EXISTS idx_v21_productions_variant ON v2_1.productions(content_variant_id);
CREATE INDEX IF NOT EXISTS idx_v21_shots_production ON v2_1.shots(production_id, shot_number);
CREATE INDEX IF NOT EXISTS idx_v21_artifacts_production ON v2_1.artifacts(production_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_v21_jobs_status ON v2_1.jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_v21_stage_runs_status ON v2_1.stage_runs(status, stage);
CREATE INDEX IF NOT EXISTS idx_v21_publications_status ON v2_1.publications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_v21_metrics_publication ON v2_1.performance_metrics(publication_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_v21_events_entity ON v2_1.events(entity_type, entity_id, created_at);

COMMENT ON SCHEMA v2_1 IS 'Content Factory V2.1 foundation; isolated until the migration is explicitly promoted.';
COMMENT ON TABLE v2_1.jobs IS 'Idempotent orchestration jobs; idempotency_key must be deterministic for retry-safe work.';
COMMENT ON TABLE v2_1.artifacts IS 'Logical creative outputs; artifact_versions stores immutable generated versions.';
COMMENT ON TABLE v2_1.generation_runs IS 'Provider/model execution provenance keyed by deterministic request_hash.';
