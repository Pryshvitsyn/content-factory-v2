-- Avatar Studio V1.2: Passport Lab and strict identity-version L0 -> L1 certification.
-- Forward-only recovery: disable Passport Lab routes. All identity locks, plans,
-- candidates, QA and human decisions are immutable evidence and must be retained.
BEGIN;

CREATE TABLE IF NOT EXISTS avatar_studio.identity_lock_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  version integer NOT NULL,
  permanent_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  temporary_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  uncertain_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  classification_notes text,
  lock_hash text NOT NULL,
  provenance jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(identity_version_id,version),
  CHECK (version > 0),
  CHECK (jsonb_typeof(permanent_attributes)='object'),
  CHECK (jsonb_typeof(temporary_attributes)='object'),
  CHECK (jsonb_typeof(uncertain_attributes)='object'),
  CHECK (NOT (permanent_attributes ?| ARRAY['wardrobe','clothing','outfit','jacket','shirt','trousers','shoes','hat','props','logos','background','environment','location','furniture','vehicle','lighting','camera','colour_grade']))
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_generation_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
  source_asset_ids jsonb NOT NULL,
  required_views jsonb NOT NULL,
  studio_specification jsonb NOT NULL,
  camera_specification jsonb NOT NULL,
  identity_constraints jsonb NOT NULL,
  negative_constraints jsonb NOT NULL,
  requested_candidate_count integer NOT NULL DEFAULT 4,
  prompt_version text NOT NULL,
  spec_version text NOT NULL,
  provider_capability_requirements jsonb NOT NULL,
  preferred_provider text,
  preferred_model text,
  cost_plan jsonb NOT NULL,
  planned_external_call_count integer NOT NULL DEFAULT 0,
  execution_authorized boolean NOT NULL DEFAULT false,
  human_approval_state text NOT NULL DEFAULT 'NOT_APPROVED',
  original_generation_spec_id uuid REFERENCES avatar_studio.passport_generation_specs(id),
  repair_delta jsonb,
  plan_fingerprint text NOT NULL,
  provenance jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(workspace_id,plan_fingerprint),
  CHECK (requested_candidate_count >= 3),
  CHECK (planned_external_call_count >= 0),
  CHECK (execution_authorized = false),
  CHECK (human_approval_state IN ('NOT_APPROVED','PLAN_REVIEWED','EXECUTION_APPROVAL_REQUIRED')),
  CHECK (jsonb_array_length(required_views)=3)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
  generation_spec_id uuid NOT NULL REFERENCES avatar_studio.passport_generation_specs(id),
  intake_asset_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id),
  source_asset_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id),
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  source_asset_ids jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  provider_request_id text,
  prompt_version text NOT NULL,
  spec_version text NOT NULL,
  known_cost numeric(14,6),
  cost_status text NOT NULL DEFAULT 'UNKNOWN',
  provenance jsonb NOT NULL,
  repair_parent_candidate_id uuid REFERENCES avatar_studio.passport_candidates(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(workspace_id,brand_id,artifact_id,artifact_version),
  CHECK (artifact_version > 0),
  CHECK (cost_status IN ('KNOWN','UNKNOWN')),
  CHECK ((cost_status='UNKNOWN' AND known_cost IS NULL) OR (cost_status='KNOWN' AND known_cost IS NOT NULL AND known_cost>=0))
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_qa_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES avatar_studio.passport_candidates(id),
  engine text NOT NULL,
  engine_version text NOT NULL,
  status text NOT NULL,
  same_person_confidence numeric(5,4),
  dimensions jsonb NOT NULL,
  panel_regions jsonb NOT NULL,
  checks jsonb NOT NULL,
  warnings jsonb NOT NULL,
  blocking_failures jsonb NOT NULL,
  reasoning jsonb NOT NULL,
  source_evidence jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (status IN ('PASS_FOR_REVIEW','WARN','REJECT')),
  CHECK (same_person_confidence IS NULL OR (same_person_confidence>=0 AND same_person_confidence<=1))
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_candidate_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES avatar_studio.passport_candidates(id),
  qa_snapshot_id uuid REFERENCES avatar_studio.passport_qa_snapshots(id),
  action text NOT NULL,
  rejection_reason text,
  human_note text,
  guided_review jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (action IN ('KEEP','REJECT','COMPARE','SUPERSEDE')),
  CHECK (rejection_reason IS NULL OR rejection_reason IN ('PROFILE_DRIFT','NOSE_CHANGED','JAW_CHANGED','CHIN_CHANGED','AGE_CHANGED','HAIR_CHANGED','HAIRLINE_CHANGED','FACE_CHANGED','ACCESSORY_CONTAMINATION','WARDROBE_CONTAMINATION','BACKGROUND_ERROR','LIGHTING_ERROR','IMAGE_QUALITY','OTHER')),
  CHECK (action<>'REJECT' OR rejection_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_certification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  vertical_code text NOT NULL,
  character_id uuid NOT NULL,
  identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
  identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
  candidate_id uuid NOT NULL REFERENCES avatar_studio.passport_candidates(id),
  source_artifact_id text NOT NULL,
  source_artifact_version integer NOT NULL,
  qa_snapshot_id uuid NOT NULL REFERENCES avatar_studio.passport_qa_snapshots(id),
  warnings_acknowledged jsonb NOT NULL DEFAULT '[]'::jsonb,
  explicit_confirmation boolean NOT NULL,
  certified_by text NOT NULL,
  certified_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (explicit_confirmation=true),
  CHECK (source_artifact_version>0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_avatar_passport_certified_identity_version
  ON avatar_studio.passport_certification_events(identity_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_avatar_passport_certified_candidate
  ON avatar_studio.passport_certification_events(candidate_id);
CREATE INDEX IF NOT EXISTS idx_avatar_identity_locks_character
  ON avatar_studio.identity_lock_versions(character_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_specs_character
  ON avatar_studio.passport_generation_specs(character_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_candidates_character
  ON avatar_studio.passport_candidates(character_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_qa_candidate
  ON avatar_studio.passport_qa_snapshots(candidate_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_passport_reviews_candidate
  ON avatar_studio.passport_candidate_review_events(candidate_id,decided_at DESC);

ALTER TABLE avatar_studio.source_asset_roles DROP CONSTRAINT IF EXISTS source_asset_roles_role_check;
ALTER TABLE avatar_studio.source_asset_roles ADD CONSTRAINT source_asset_roles_role_check CHECK
  (role IN ('IDENTITY','PASSPORT_SOURCE','PASSPORT_CANDIDATE','VOICE_SOURCE','WARDROBE','PRODUCT','LOCATION','STYLE_REFERENCE','PREVIOUS_SHOT'));

CREATE OR REPLACE FUNCTION avatar_studio.enforce_passport_lab_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE avatar_workspace uuid; avatar_vertical text; brand_workspace uuid; identity_character uuid; lock_identity uuid;
BEGIN
  SELECT workspace_id,vertical_code INTO avatar_workspace,avatar_vertical FROM avatar_studio.characters WHERE id=NEW.character_id;
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF avatar_workspace IS NULL OR avatar_workspace<>NEW.workspace_id OR brand_workspace<>NEW.workspace_id
     OR (to_jsonb(NEW) ? 'vertical_code' AND (to_jsonb(NEW)->>'vertical_code')<>avatar_vertical)
     OR NOT EXISTS(SELECT 1 FROM avatar_studio.brand_permissions WHERE character_id=NEW.character_id AND brand_id=NEW.brand_id AND allowed) THEN
    RAISE EXCEPTION 'Avatar Studio Passport Lab workspace/brand/vertical isolation violation';
  END IF;
  IF to_jsonb(NEW) ? 'identity_version_id' THEN
    SELECT character_id INTO identity_character FROM avatar_studio.character_versions WHERE id=NEW.identity_version_id;
    IF identity_character IS NULL OR identity_character<>NEW.character_id THEN
      RAISE EXCEPTION 'Passport Lab identity version scope violation';
    END IF;
  END IF;
  IF to_jsonb(NEW) ? 'identity_lock_version_id' THEN
    SELECT identity_version_id INTO lock_identity FROM avatar_studio.identity_lock_versions WHERE id=NEW.identity_lock_version_id;
    IF lock_identity IS NULL OR lock_identity<>NEW.identity_version_id THEN
      RAISE EXCEPTION 'Passport Lab Identity Lock scope violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['identity_lock_versions','passport_generation_specs','passport_candidates',
    'passport_qa_snapshots','passport_candidate_review_events','passport_certification_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope_guard ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_scope_guard BEFORE INSERT ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_passport_lab_scope()',table_name,table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION avatar_studio.enforce_passport_human_certification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qa_status text; candidate_record avatar_studio.passport_candidates%ROWTYPE; latest_identity uuid; latest_lock uuid;
BEGIN
  SELECT * INTO candidate_record FROM avatar_studio.passport_candidates WHERE id=NEW.candidate_id FOR SHARE;
  SELECT status INTO qa_status FROM avatar_studio.passport_qa_snapshots WHERE id=NEW.qa_snapshot_id AND candidate_id=NEW.candidate_id;
  SELECT id INTO latest_identity FROM avatar_studio.character_versions WHERE character_id=NEW.character_id ORDER BY version DESC LIMIT 1;
  SELECT id INTO latest_lock FROM avatar_studio.identity_lock_versions WHERE identity_version_id=NEW.identity_version_id ORDER BY version DESC LIMIT 1;
  IF candidate_record.id IS NULL OR candidate_record.identity_version_id<>NEW.identity_version_id
     OR candidate_record.identity_lock_version_id<>NEW.identity_lock_version_id THEN
    RAISE EXCEPTION 'Passport certification candidate/version mismatch';
  END IF;
  IF latest_identity<>NEW.identity_version_id THEN RAISE EXCEPTION 'Only the current Identity Version may be passport-certified'; END IF;
  IF latest_lock IS NULL OR latest_lock<>NEW.identity_lock_version_id THEN RAISE EXCEPTION 'Only the current Identity Lock may be passport-certified'; END IF;
  IF qa_status IS NULL OR qa_status='REJECT' THEN RAISE EXCEPTION 'A non-rejected immutable QA snapshot is required'; END IF;
  IF EXISTS(SELECT 1 FROM avatar_studio.passport_candidate_review_events
    WHERE candidate_id=NEW.candidate_id AND action='REJECT') THEN
    RAISE EXCEPTION 'A human-rejected candidate cannot be certified';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS avatar_passport_human_certification_guard ON avatar_studio.passport_certification_events;
CREATE TRIGGER avatar_passport_human_certification_guard BEFORE INSERT ON avatar_studio.passport_certification_events
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_passport_human_certification();

CREATE OR REPLACE FUNCTION avatar_studio.enforce_level_one_certification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest_identity uuid; latest_lock uuid; has_certificate boolean;
BEGIN
  IF NEW.current_level<1 THEN RETURN NEW; END IF;
  SELECT id INTO latest_identity FROM avatar_studio.character_versions WHERE character_id=NEW.character_id ORDER BY version DESC LIMIT 1;
  SELECT id INTO latest_lock FROM avatar_studio.identity_lock_versions WHERE identity_version_id=latest_identity ORDER BY version DESC LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM avatar_studio.passport_certification_events
      WHERE character_id=NEW.character_id AND identity_version_id=latest_identity AND identity_lock_version_id=latest_lock)
    OR (NOT EXISTS(SELECT 1 FROM avatar_studio.identity_lock_versions WHERE character_id=NEW.character_id)
      AND EXISTS(SELECT 1 FROM avatar_studio.passport_certifications WHERE character_id=NEW.character_id AND decision='CERTIFIED'))
    INTO has_certificate;
  IF NOT has_certificate THEN RAISE EXCEPTION 'CERTIFIED_PASSPORT_REQUIRED'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS avatar_level_one_certification_guard ON avatar_studio.level_states;
CREATE TRIGGER avatar_level_one_certification_guard BEFORE INSERT OR UPDATE OF current_level ON avatar_studio.level_states
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_level_one_certification();

COMMIT;
