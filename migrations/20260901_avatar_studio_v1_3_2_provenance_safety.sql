-- Avatar Studio V1.3.2: append-only provenance correction and fail-closed production eligibility.
-- Historical character, identity, source, consent and artifact records remain immutable.
BEGIN;

CREATE TABLE IF NOT EXISTS avatar_studio.character_provenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  event_key text NOT NULL,
  event_type text NOT NULL,
  subject_classification text NOT NULL,
  production_eligibility text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  supersedes_event_id uuid REFERENCES avatar_studio.character_provenance_events(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(character_id,event_key),
  CHECK (event_type IN ('PROVENANCE_DISPUTED','NON_PRODUCTION_ENFORCED','PROVENANCE_ESTABLISHED')),
  CHECK (subject_classification IN ('SYNTHETIC','REAL_PERSON_DERIVED','APPROVED_CHARACTER','UNKNOWN')),
  CHECK (production_eligibility IN ('BLOCKED','ELIGIBLE')),
  CHECK (event_type<>'PROVENANCE_ESTABLISHED' OR production_eligibility='ELIGIBLE')
);

DROP TRIGGER IF EXISTS character_provenance_events_immutable_change ON avatar_studio.character_provenance_events;
CREATE TRIGGER character_provenance_events_immutable_change
BEFORE UPDATE OR DELETE ON avatar_studio.character_provenance_events
FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();

-- Known local smoke identity: preserve the false historical SYNTHETIC record, but
-- supersede its operational meaning with an explicit non-production safety event.
INSERT INTO avatar_studio.character_provenance_events
  (workspace_id,character_id,event_key,event_type,subject_classification,production_eligibility,reason,evidence,recorded_by)
SELECT c.workspace_id,c.id,'SMOKE_TEST_01_REAL_PERSON_DERIVED_GUARD_V1','NON_PRODUCTION_ENFORCED',
  'REAL_PERSON_DERIVED','BLOCKED',
  'Historical SYNTHETIC classification is disputed; real-person-derived source lacks established production provenance and consent.',
  jsonb_build_object('smokeOnly',true,'historicalSubjectType',c.subject_type,'immutableHistoryPreserved',true),
  'avatar-studio-v1.3.2-migration'
FROM avatar_studio.characters c
WHERE c.id='f9f5733b-d873-4ba1-a0ae-2323dfe6a725'::uuid
  AND c.internal_name='SMOKE_TEST_01_DO_NOT_REUSE' AND c.subject_type='SYNTHETIC'
ON CONFLICT(character_id,event_key) DO NOTHING;

CREATE OR REPLACE FUNCTION avatar_studio.enforce_passport_provenance_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eligibility text;
BEGIN
  SELECT production_eligibility INTO eligibility
  FROM avatar_studio.character_provenance_events
  WHERE character_id=NEW.character_id ORDER BY recorded_at DESC,id DESC LIMIT 1;
  IF eligibility='BLOCKED' THEN RAISE EXCEPTION 'AVATAR_PROVENANCE_NOT_PRODUCTION_ELIGIBLE'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS avatar_passport_provenance_eligibility_guard ON avatar_studio.passport_certification_events;
CREATE TRIGGER avatar_passport_provenance_eligibility_guard
BEFORE INSERT ON avatar_studio.passport_certification_events
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_passport_provenance_eligibility();

COMMIT;
