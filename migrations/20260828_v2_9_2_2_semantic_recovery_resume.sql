BEGIN;

ALTER TABLE v2_9.semantic_evaluation_attempts
  DROP CONSTRAINT IF EXISTS semantic_evaluation_attempts_expected_semantic_calls_check;

ALTER TABLE v2_9.semantic_evaluation_attempts
  ADD CONSTRAINT semantic_evaluation_attempts_expected_semantic_calls_check
    CHECK (expected_semantic_calls BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS reused_semantic_attempt_id uuid
    REFERENCES v2_9.semantic_evaluation_attempts(id),
  ADD COLUMN IF NOT EXISTS recovery_phase text NOT NULL DEFAULT 'BEFORE_SEMANTIC';

DO $$ BEGIN
  ALTER TABLE v2_9.semantic_evaluation_attempts
    ADD CONSTRAINT semantic_evaluation_attempts_recovery_phase_check CHECK (recovery_phase IN (
      'BEFORE_SEMANTIC','SEMANTIC_FAILED','SEMANTIC_PASSED',
      'POST_PASS_MEDIA_FAILED','MASTER_FAILED','SUCCEEDED'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS semantic_evaluation_attempts_latest_recovery
  ON v2_9.semantic_evaluation_attempts(production_id,asset_id,attempt DESC);

CREATE OR REPLACE FUNCTION v2_9.enforce_semantic_resume_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE reused v2_9.semantic_evaluation_attempts%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.reused_semantic_attempt_id IS DISTINCT FROM OLD.reused_semantic_attempt_id
    OR NEW.expected_semantic_calls IS DISTINCT FROM OLD.expected_semantic_calls) THEN
    RAISE EXCEPTION 'semantic recovery resume identity is immutable';
  END IF;
  IF NEW.reused_semantic_attempt_id IS NULL THEN
    IF NEW.expected_semantic_calls <> 1 THEN RAISE EXCEPTION 'new semantic evaluation must expect one call'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO reused FROM v2_9.semantic_evaluation_attempts WHERE id=NEW.reused_semantic_attempt_id;
  IF reused.id IS NULL OR NEW.expected_semantic_calls <> 0 OR reused.status <> 'FAILED'
    OR reused.result_evidence->>'status' <> 'PASS' OR reused.workspace_id <> NEW.workspace_id
    OR reused.brand_id <> NEW.brand_id OR reused.production_id <> NEW.production_id
    OR reused.asset_id <> NEW.asset_id OR reused.attempt >= NEW.attempt
    OR reused.source_artifact <> NEW.source_artifact OR reused.previous_evidence <> NEW.previous_evidence
    OR reused.evaluator_provider <> NEW.evaluator_provider OR reused.evaluator_model <> NEW.evaluator_model THEN
    RAISE EXCEPTION 'semantic recovery resume lineage mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS semantic_evaluation_attempt_resume_lineage ON v2_9.semantic_evaluation_attempts;
CREATE TRIGGER semantic_evaluation_attempt_resume_lineage BEFORE INSERT OR UPDATE
ON v2_9.semantic_evaluation_attempts FOR EACH ROW EXECUTE FUNCTION v2_9.enforce_semantic_resume_lineage();

COMMIT;

-- Forward-only recovery: these additive fields preserve immutable attempt lineage and
-- distinguish zero-evaluator resume attempts. Disable the recovery route to roll back behavior.
