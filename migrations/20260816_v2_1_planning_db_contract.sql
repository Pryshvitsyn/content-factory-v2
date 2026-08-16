-- V2.1 deterministic planning boundary.
-- ASSET_PLAN and SHOT_PLAN are derived from the immutable BIBLE/SCRIPT context.
-- PostgreSQL owns their provenance, production ownership and immutable planning fields.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check
  CHECK (artifact_type IN (
    'IDEA_SET','CONTENT_BRIEF','CONCEPT','SCRIPT','PRODUCTION_BIBLE',
    'ASSET_REQUIREMENTS','SHOTS',
    'REFERENCE_IMAGE','IMAGE','VIDEO','VOICE','AUDIO','MUSIC','CAPTIONS',
    'EDIT','FINAL_VIDEO','THUMBNAIL'
  ));

UPDATE v2_1.stage_definitions
   SET requires = CASE
     WHEN stage = 'SHOT_PLAN' THEN '["PRODUCTION_BIBLE","SCRIPT"]'::jsonb
     WHEN stage = 'ASSET_PLAN' THEN '["PRODUCTION_BIBLE","SHOTS"]'::jsonb
     ELSE requires
   END,
   parallel_group = NULL
 WHERE stage IN ('ASSET_PLAN','SHOT_PLAN');

ALTER TABLE v2_1.shots
  ADD COLUMN IF NOT EXISTS shot_key text,
  ADD COLUMN IF NOT EXISTS production_bible_id uuid,
  ADD COLUMN IF NOT EXISTS source_script_artifact_id uuid,
  ADD COLUMN IF NOT EXISTS context_fingerprint text,
  ADD COLUMN IF NOT EXISTS plan_fingerprint text;

ALTER TABLE v2_1.asset_requirements
  ADD COLUMN IF NOT EXISTS production_bible_id uuid,
  ADD COLUMN IF NOT EXISTS context_fingerprint text,
  ADD COLUMN IF NOT EXISTS plan_fingerprint text;

DO $$
BEGIN
  ALTER TABLE v2_1.shots DROP CONSTRAINT IF EXISTS shots_bible_fk;
  ALTER TABLE v2_1.shots ADD CONSTRAINT shots_bible_fk
    FOREIGN KEY (production_bible_id) REFERENCES v2_1.production_bibles(id) ON DELETE RESTRICT;

  ALTER TABLE v2_1.shots DROP CONSTRAINT IF EXISTS shots_script_artifact_fk;
  ALTER TABLE v2_1.shots ADD CONSTRAINT shots_script_artifact_fk
    FOREIGN KEY (source_script_artifact_id) REFERENCES v2_1.artifacts(id) ON DELETE RESTRICT;

  ALTER TABLE v2_1.asset_requirements DROP CONSTRAINT IF EXISTS asset_requirements_bible_fk;
  ALTER TABLE v2_1.asset_requirements ADD CONSTRAINT asset_requirements_bible_fk
    FOREIGN KEY (production_bible_id) REFERENCES v2_1.production_bibles(id) ON DELETE RESTRICT;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_shots_key
  ON v2_1.shots(production_id, shot_key)
  WHERE shot_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_shots_plan_fingerprint
  ON v2_1.shots(production_id, plan_fingerprint);

CREATE INDEX IF NOT EXISTS idx_v21_asset_requirements_plan_fingerprint
  ON v2_1.asset_requirements(production_bible_id, plan_fingerprint);

CREATE OR REPLACE FUNCTION v2_1.enforce_planning_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bible_production uuid;
  script_production uuid;
  shot_production uuid;
  shot_bible uuid;
BEGIN
  IF NEW.production_bible_id IS NULL THEN
    RAISE EXCEPTION '% must reference a production BIBLE', TG_TABLE_NAME;
  END IF;

  SELECT production_id INTO bible_production
    FROM v2_1.production_bibles
   WHERE id = NEW.production_bible_id;

  IF TG_TABLE_NAME = 'shots' THEN
    IF bible_production IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'SHOT_PLAN row % belongs to a different production BIBLE', NEW.id;
    END IF;

    IF NEW.source_script_artifact_id IS NOT NULL THEN
      SELECT production_id INTO script_production
        FROM v2_1.artifacts
       WHERE id = NEW.source_script_artifact_id;
      IF script_production IS DISTINCT FROM NEW.production_id THEN
        RAISE EXCEPTION 'SHOT_PLAN source SCRIPT % belongs to a different production', NEW.source_script_artifact_id;
      END IF;
    END IF;
  ELSE
    SELECT s.production_id, s.production_bible_id INTO shot_production, shot_bible
      FROM v2_1.shots s
     WHERE s.id = NEW.shot_id;
    IF shot_production IS NULL THEN
      RAISE EXCEPTION 'ASSET_PLAN shot % does not exist', NEW.shot_id;
    END IF;
    IF bible_production IS DISTINCT FROM shot_production
       OR NEW.production_bible_id IS DISTINCT FROM shot_bible THEN
      RAISE EXCEPTION 'ASSET_PLAN row % belongs to a different production BIBLE', NEW.id;
    END IF;
  END IF;

  IF NEW.context_fingerprint IS NULL OR btrim(NEW.context_fingerprint) = '' THEN
    RAISE EXCEPTION '% context_fingerprint is required', TG_TABLE_NAME;
  END IF;
  IF NEW.plan_fingerprint IS NULL OR btrim(NEW.plan_fingerprint) = '' THEN
    RAISE EXCEPTION '% plan_fingerprint is required', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shots_planning_boundary ON v2_1.shots;
CREATE TRIGGER trg_shots_planning_boundary
BEFORE INSERT OR UPDATE ON v2_1.shots
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_planning_boundary();

DROP TRIGGER IF EXISTS trg_asset_requirements_planning_boundary ON v2_1.asset_requirements;
CREATE TRIGGER trg_asset_requirements_planning_boundary
BEFORE INSERT OR UPDATE ON v2_1.asset_requirements
FOR EACH ROW EXECUTE FUNCTION v2_1.enforce_planning_boundary();

CREATE OR REPLACE FUNCTION v2_1.prevent_planning_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'shots' THEN
    IF OLD.production_id IS DISTINCT FROM NEW.production_id
       OR OLD.shot_number IS DISTINCT FROM NEW.shot_number
       OR OLD.duration_ms IS DISTINCT FROM NEW.duration_ms
       OR OLD.instructions IS DISTINCT FROM NEW.instructions
       OR OLD.shot_key IS DISTINCT FROM NEW.shot_key
       OR OLD.production_bible_id IS DISTINCT FROM NEW.production_bible_id
       OR OLD.source_script_artifact_id IS DISTINCT FROM NEW.source_script_artifact_id
       OR OLD.context_fingerprint IS DISTINCT FROM NEW.context_fingerprint
       OR OLD.plan_fingerprint IS DISTINCT FROM NEW.plan_fingerprint THEN
      RAISE EXCEPTION 'SHOT_PLAN definition is immutable; create a new production version';
    END IF;
  ELSE
    IF OLD.shot_id IS DISTINCT FROM NEW.shot_id
       OR OLD.asset_role IS DISTINCT FROM NEW.asset_role
       OR OLD.required_asset_type IS DISTINCT FROM NEW.required_asset_type
       OR OLD.required_asset_id IS DISTINCT FROM NEW.required_asset_id
       OR OLD.constraints IS DISTINCT FROM NEW.constraints
       OR OLD.production_bible_id IS DISTINCT FROM NEW.production_bible_id
       OR OLD.context_fingerprint IS DISTINCT FROM NEW.context_fingerprint
       OR OLD.plan_fingerprint IS DISTINCT FROM NEW.plan_fingerprint THEN
      RAISE EXCEPTION 'ASSET_PLAN definition is immutable; create a new production version';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shots_planning_immutable ON v2_1.shots;
CREATE TRIGGER trg_shots_planning_immutable
BEFORE UPDATE ON v2_1.shots
FOR EACH ROW EXECUTE FUNCTION v2_1.prevent_planning_definition_mutation();

DROP TRIGGER IF EXISTS trg_asset_requirements_planning_immutable ON v2_1.asset_requirements;
CREATE TRIGGER trg_asset_requirements_planning_immutable
BEFORE UPDATE ON v2_1.asset_requirements
FOR EACH ROW EXECUTE FUNCTION v2_1.prevent_planning_definition_mutation();

COMMENT ON TABLE v2_1.shots IS
  'Durable SHOT_PLAN rows. Definition/provenance fields are immutable; lifecycle status may advance downstream.';
COMMENT ON TABLE v2_1.asset_requirements IS
  'Durable ASSET_PLAN rows. Definition/provenance fields are immutable; fulfillment status may advance downstream.';
COMMENT ON FUNCTION v2_1.enforce_planning_boundary() IS
  'Database-enforced production BIBLE/SCRIPT ownership and deterministic planning fingerprints.';
COMMENT ON FUNCTION v2_1.prevent_planning_definition_mutation() IS
  'Prevents silent mutation of deterministic ASSET_PLAN/SHOT_PLAN definitions after creation.';
