BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_9;

CREATE TABLE IF NOT EXISTS v2_9.semantic_evaluation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  production_id uuid NOT NULL REFERENCES v2_1.productions(id),
  job_id uuid NOT NULL REFERENCES v2_1.jobs(id),
  asset_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  source_artifact jsonb NOT NULL,
  previous_evidence jsonb NOT NULL,
  result_evidence jsonb,
  evaluator_provider text NOT NULL,
  evaluator_model text NOT NULL,
  expected_video_calls integer NOT NULL DEFAULT 0 CHECK (expected_video_calls = 0),
  expected_speech_calls integer NOT NULL DEFAULT 0 CHECK (expected_speech_calls = 0),
  expected_semantic_calls integer NOT NULL DEFAULT 1 CHECK (expected_semantic_calls = 1),
  actual_semantic_calls integer NOT NULL DEFAULT 0 CHECK (actual_semantic_calls BETWEEN 0 AND 1),
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (production_id, asset_id, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_evaluation_attempts_one_running
  ON v2_9.semantic_evaluation_attempts(production_id, asset_id) WHERE status='RUNNING';

CREATE OR REPLACE FUNCTION v2_9.enforce_semantic_attempt_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE production_workspace uuid; production_brand uuid; brand_workspace uuid;
BEGIN
  SELECT workspace_id, brand_id INTO production_workspace, production_brand
  FROM v2_1.productions WHERE id=NEW.production_id;
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF production_workspace IS NULL OR production_workspace <> NEW.workspace_id
    OR production_brand <> NEW.brand_id OR brand_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'semantic evaluation attempt ownership mismatch';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.production_id IS DISTINCT FROM OLD.production_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
    OR NEW.attempt IS DISTINCT FROM OLD.attempt OR NEW.source_artifact IS DISTINCT FROM OLD.source_artifact
    OR NEW.previous_evidence IS DISTINCT FROM OLD.previous_evidence
    OR NEW.evaluator_provider IS DISTINCT FROM OLD.evaluator_provider OR NEW.evaluator_model IS DISTINCT FROM OLD.evaluator_model) THEN
    RAISE EXCEPTION 'semantic evaluation attempt identity is immutable';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.status <> 'RUNNING' OR NEW.status NOT IN ('SUCCEEDED','FAILED')) THEN
    RAISE EXCEPTION 'semantic evaluation attempt terminal evidence is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS semantic_evaluation_attempt_ownership ON v2_9.semantic_evaluation_attempts;
CREATE TRIGGER semantic_evaluation_attempt_ownership BEFORE INSERT OR UPDATE
ON v2_9.semantic_evaluation_attempts FOR EACH ROW EXECUTE FUNCTION v2_9.enforce_semantic_attempt_ownership();

CREATE OR REPLACE FUNCTION v2_9.reject_semantic_attempt_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'semantic evaluation attempt evidence cannot be deleted'; END $$;

DROP TRIGGER IF EXISTS semantic_evaluation_attempt_no_delete ON v2_9.semantic_evaluation_attempts;
CREATE TRIGGER semantic_evaluation_attempt_no_delete BEFORE DELETE
ON v2_9.semantic_evaluation_attempts FOR EACH ROW EXECUTE FUNCTION v2_9.reject_semantic_attempt_delete();

COMMIT;

-- Forward-only recovery: attempt history is immutable production evidence. Disable the
-- semantic-retry route to roll back behavior; do not delete recorded attempts.
