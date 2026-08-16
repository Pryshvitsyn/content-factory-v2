-- V2.1 database contract hardening.
-- The database is the final authority for stage dependencies, stage outputs,
-- and generation audit events. This closes drift between JS contracts and SQL.

-- 0. Complete the generation provenance schema before installing any audit
--    trigger that references artifact_id. This is deliberately idempotent so
--    the migration is safe against databases created by earlier V2.1 patches.
ALTER TABLE v2_1.generation_runs
  ADD COLUMN IF NOT EXISTS artifact_id uuid REFERENCES v2_1.artifacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_v21_generation_runs_artifact
  ON v2_1.generation_runs(artifact_id)
  WHERE artifact_id IS NOT NULL;

COMMENT ON COLUMN v2_1.generation_runs.artifact_id IS
  'Canonical output artifact produced by this generation attempt; part of durable provenance.';

-- 1. Keep the database stage graph identical to the canonical production contract.
UPDATE v2_1.stage_definitions
   SET requires = '["CONCEPT","IDEA_SET"]'::jsonb
 WHERE stage = 'SCRIPT';

-- 2. A completed stage may only claim outputs declared by its database contract.
--    Both containment directions plus cardinality make the output set exact.
CREATE OR REPLACE FUNCTION v2_1.enforce_stage_output_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected jsonb;
  actual jsonb;
BEGIN
  IF NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT outputs INTO expected
  FROM v2_1.stage_definitions
  WHERE stage = NEW.stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot complete unknown stage %', NEW.stage;
  END IF;

  actual := COALESCE(NEW.output_artifacts, '[]'::jsonb);

  IF jsonb_typeof(actual) <> 'array'
     OR jsonb_array_length(actual) <> jsonb_array_length(expected)
     OR NOT (actual @> expected)
     OR NOT (expected @> actual) THEN
    RAISE EXCEPTION 'Stage % output contract violation: expected %, got %',
      NEW.stage, expected, actual;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_runs_output_contract ON v2_1.stage_runs;
CREATE TRIGGER trg_stage_runs_output_contract
BEFORE INSERT OR UPDATE OF status, output_artifacts ON v2_1.stage_runs
FOR EACH ROW
EXECUTE FUNCTION v2_1.enforce_stage_output_contract();

-- 3. Generation runs are part of the durable audit ledger. The generation_runs
--    row remains the detailed provenance record; events provide a chronological
--    audit trail without duplicating the full request/response payloads.
CREATE OR REPLACE FUNCTION v2_1.audit_generation_run_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.artifact_id IS DISTINCT FROM NEW.artifact_id THEN
    INSERT INTO v2_1.events(event_type, entity_type, entity_id, payload)
    VALUES (
      CASE WHEN TG_OP = 'INSERT' THEN 'GENERATION_RUN_CREATED' ELSE 'GENERATION_RUN_UPDATED' END,
      'generation_run',
      NEW.id,
      jsonb_build_object(
        'stage_run_id', NEW.stage_run_id,
        'provider_id', NEW.provider_id,
        'model_id', NEW.model_id,
        'capability', NEW.capability,
        'request_hash', NEW.request_hash,
        'status', NEW.status,
        'artifact_id', NEW.artifact_id,
        'recorded_at', now()
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generation_runs_audit ON v2_1.generation_runs;
CREATE TRIGGER trg_generation_runs_audit
AFTER INSERT OR UPDATE OF status, artifact_id ON v2_1.generation_runs
FOR EACH ROW
EXECUTE FUNCTION v2_1.audit_generation_run_change();

CREATE INDEX IF NOT EXISTS idx_v21_events_generation_run
  ON v2_1.events(entity_type, entity_id, created_at)
  WHERE entity_type = 'generation_run';

COMMENT ON FUNCTION v2_1.enforce_stage_output_contract() IS
  'Database-enforced stage output contract. Completed stages cannot claim undeclared or missing outputs.';
COMMENT ON FUNCTION v2_1.audit_generation_run_change() IS
  'Append-only audit projection for generation lifecycle changes; detailed request/response remains in generation_runs.';
