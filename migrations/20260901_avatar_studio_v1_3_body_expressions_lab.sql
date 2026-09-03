-- Avatar Studio V1.3: Body + Expressions Lab and strict human-certified L1 -> L2 boundary.
-- Forward-only recovery: disable V1.3 routes; retain all immutable evidence and leave prior levels unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS avatar_studio.body_build_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
 vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code), character_id uuid NOT NULL,
 identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
 identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id),
 passport_certification_event_id uuid NOT NULL REFERENCES avatar_studio.passport_certification_events(id), version integer NOT NULL,
 profile jsonb NOT NULL, profile_hash text NOT NULL, provenance jsonb NOT NULL, approved_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 UNIQUE(passport_certification_event_id,version), CHECK(version>0), CHECK(jsonb_typeof(profile)='object'),
 CHECK(NOT (profile ?| ARRAY['medical_measurements','diagnosis','ethnicity','religion','sexual_orientation','exact_weight','exact_height']))
);

CREATE TABLE IF NOT EXISTS avatar_studio.body_generation_specs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL REFERENCES v2_2.brands(id), vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL REFERENCES avatar_studio.character_versions(id),
 identity_lock_version_id uuid NOT NULL REFERENCES avatar_studio.identity_lock_versions(id), passport_certification_event_id uuid NOT NULL REFERENCES avatar_studio.passport_certification_events(id),
 body_build_version_id uuid NOT NULL REFERENCES avatar_studio.body_build_versions(id), reference_type text NOT NULL,
 specification jsonb NOT NULL, provider_capability text NOT NULL, preferred_provider text, preferred_model text,
 requested_candidate_count integer NOT NULL, calls_per_candidate integer NOT NULL DEFAULT 1, cost_plan jsonb NOT NULL,
 prompt_version text NOT NULL, spec_version text NOT NULL, approval_state text NOT NULL, execution_authorized boolean NOT NULL DEFAULT false,
 original_generation_spec_id uuid REFERENCES avatar_studio.body_generation_specs(id), repair_delta jsonb, plan_fingerprint text NOT NULL,
 provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id), UNIQUE(workspace_id,plan_fingerprint),
 CHECK(reference_type IN ('CHEST_UP_NEUTRAL','FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL')), CHECK(requested_candidate_count BETWEEN 1 AND 12),
 CHECK(calls_per_candidate=1), CHECK(execution_authorized=false), CHECK(provider_capability='CHARACTER_BODY_REFERENCE')
);

CREATE TABLE IF NOT EXISTS avatar_studio.expression_generation_specs (LIKE avatar_studio.body_generation_specs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_generation_specs_id ON avatar_studio.expression_generation_specs(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_generation_specs_fingerprint ON avatar_studio.expression_generation_specs(workspace_id,plan_fingerprint);
ALTER TABLE avatar_studio.expression_generation_specs DROP CONSTRAINT IF EXISTS body_generation_specs_reference_type_check;
ALTER TABLE avatar_studio.expression_generation_specs DROP CONSTRAINT IF EXISTS body_generation_specs_provider_capability_check;
ALTER TABLE avatar_studio.expression_generation_specs DROP CONSTRAINT IF EXISTS expression_generation_specs_reference_type_l2_check;
ALTER TABLE avatar_studio.expression_generation_specs ADD CONSTRAINT expression_generation_specs_reference_type_l2_check CHECK(reference_type IN ('NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED','ENERGETIC_POSITIVE'));
ALTER TABLE avatar_studio.expression_generation_specs DROP CONSTRAINT IF EXISTS expression_generation_specs_capability_l2_check;
ALTER TABLE avatar_studio.expression_generation_specs ADD CONSTRAINT expression_generation_specs_capability_l2_check CHECK(provider_capability='CHARACTER_EXPRESSION_REFERENCE');
ALTER TABLE avatar_studio.expression_generation_specs DROP CONSTRAINT IF EXISTS expression_generation_specs_original_generation_spec_id_fkey;
ALTER TABLE avatar_studio.expression_generation_specs ADD FOREIGN KEY(original_generation_spec_id) REFERENCES avatar_studio.expression_generation_specs(id);

CREATE TABLE IF NOT EXISTS avatar_studio.mouth_calibration_specs (LIKE avatar_studio.body_generation_specs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_specs_id ON avatar_studio.mouth_calibration_specs(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_specs_fingerprint ON avatar_studio.mouth_calibration_specs(workspace_id,plan_fingerprint);
ALTER TABLE avatar_studio.mouth_calibration_specs DROP CONSTRAINT IF EXISTS body_generation_specs_reference_type_check;
ALTER TABLE avatar_studio.mouth_calibration_specs DROP CONSTRAINT IF EXISTS body_generation_specs_provider_capability_check;
ALTER TABLE avatar_studio.mouth_calibration_specs DROP CONSTRAINT IF EXISTS mouth_calibration_specs_reference_type_l2_check;
ALTER TABLE avatar_studio.mouth_calibration_specs ADD CONSTRAINT mouth_calibration_specs_reference_type_l2_check CHECK(reference_type IN ('NEUTRAL_CLOSED','SOFT_SMILE','VISIBLE_TEETH','OOH','AAH','EE','MM_CLOSED'));
ALTER TABLE avatar_studio.mouth_calibration_specs DROP CONSTRAINT IF EXISTS mouth_calibration_specs_capability_l2_check;
ALTER TABLE avatar_studio.mouth_calibration_specs ADD CONSTRAINT mouth_calibration_specs_capability_l2_check CHECK(provider_capability='MOUTH_SHAPE_REFERENCE');
ALTER TABLE avatar_studio.mouth_calibration_specs DROP CONSTRAINT IF EXISTS mouth_calibration_specs_original_generation_spec_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_specs ADD FOREIGN KEY(original_generation_spec_id) REFERENCES avatar_studio.mouth_calibration_specs(id);

CREATE TABLE IF NOT EXISTS avatar_studio.body_reference_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, identity_lock_version_id uuid NOT NULL,
 passport_certification_event_id uuid NOT NULL, body_build_version_id uuid NOT NULL REFERENCES avatar_studio.body_build_versions(id),
 generation_spec_id uuid NOT NULL REFERENCES avatar_studio.body_generation_specs(id), reference_type text NOT NULL,
 intake_asset_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id), source_asset_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id),
 artifact_id text NOT NULL, artifact_version integer NOT NULL, provider text NOT NULL, model text NOT NULL, provider_request_id text,
 prompt_version text NOT NULL, spec_version text NOT NULL, known_cost numeric(14,6), cost_status text NOT NULL,
 provenance jsonb NOT NULL, repair_parent_candidate_id uuid REFERENCES avatar_studio.body_reference_candidates(id), created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 UNIQUE(workspace_id,brand_id,artifact_id,artifact_version), CHECK(reference_type IN ('CHEST_UP_NEUTRAL','FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL')),
 CHECK(artifact_version>0), CHECK(cost_status IN ('KNOWN','UNKNOWN'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.expression_candidates (LIKE avatar_studio.body_reference_candidates INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_candidates_id ON avatar_studio.expression_candidates(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_candidates_artifact ON avatar_studio.expression_candidates(workspace_id,brand_id,artifact_id,artifact_version);
ALTER TABLE avatar_studio.expression_candidates DROP CONSTRAINT IF EXISTS body_reference_candidates_reference_type_check;
ALTER TABLE avatar_studio.expression_candidates DROP CONSTRAINT IF EXISTS expression_candidates_reference_type_l2_check;
ALTER TABLE avatar_studio.expression_candidates ADD CONSTRAINT expression_candidates_reference_type_l2_check CHECK(reference_type IN ('NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED','ENERGETIC_POSITIVE'));
ALTER TABLE avatar_studio.expression_candidates DROP CONSTRAINT IF EXISTS expression_candidates_generation_spec_id_fkey;
ALTER TABLE avatar_studio.expression_candidates ADD FOREIGN KEY(generation_spec_id) REFERENCES avatar_studio.expression_generation_specs(id);
ALTER TABLE avatar_studio.expression_candidates DROP CONSTRAINT IF EXISTS expression_candidates_repair_parent_candidate_id_fkey;
ALTER TABLE avatar_studio.expression_candidates ADD FOREIGN KEY(repair_parent_candidate_id) REFERENCES avatar_studio.expression_candidates(id);

CREATE TABLE IF NOT EXISTS avatar_studio.mouth_calibration_candidates (LIKE avatar_studio.body_reference_candidates INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_candidates_id ON avatar_studio.mouth_calibration_candidates(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_candidates_artifact ON avatar_studio.mouth_calibration_candidates(workspace_id,brand_id,artifact_id,artifact_version);
ALTER TABLE avatar_studio.mouth_calibration_candidates DROP CONSTRAINT IF EXISTS body_reference_candidates_reference_type_check;
ALTER TABLE avatar_studio.mouth_calibration_candidates DROP CONSTRAINT IF EXISTS mouth_calibration_candidates_reference_type_l2_check;
ALTER TABLE avatar_studio.mouth_calibration_candidates ADD CONSTRAINT mouth_calibration_candidates_reference_type_l2_check CHECK(reference_type IN ('NEUTRAL_CLOSED','SOFT_SMILE','VISIBLE_TEETH','OOH','AAH','EE','MM_CLOSED'));
ALTER TABLE avatar_studio.mouth_calibration_candidates DROP CONSTRAINT IF EXISTS mouth_calibration_candidates_generation_spec_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_candidates ADD FOREIGN KEY(generation_spec_id) REFERENCES avatar_studio.mouth_calibration_specs(id);
ALTER TABLE avatar_studio.mouth_calibration_candidates DROP CONSTRAINT IF EXISTS mouth_calibration_candidates_repair_parent_candidate_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_candidates ADD FOREIGN KEY(repair_parent_candidate_id) REFERENCES avatar_studio.mouth_calibration_candidates(id);

CREATE TABLE IF NOT EXISTS avatar_studio.body_qa_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
 candidate_id uuid NOT NULL REFERENCES avatar_studio.body_reference_candidates(id), engine text NOT NULL, engine_version text NOT NULL,
 status text NOT NULL, continuity_confidence numeric(5,4), dimensions jsonb NOT NULL, checks jsonb NOT NULL, warnings jsonb NOT NULL,
 blocking_failures jsonb NOT NULL, geometry jsonb NOT NULL, reasoning jsonb NOT NULL, source_evidence jsonb NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 CHECK(status IN ('PASS_FOR_REVIEW','WARN','REJECT'))
);
CREATE TABLE IF NOT EXISTS avatar_studio.expression_qa_snapshots (LIKE avatar_studio.body_qa_snapshots INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_qa_snapshots_id ON avatar_studio.expression_qa_snapshots(id);
ALTER TABLE avatar_studio.expression_qa_snapshots DROP CONSTRAINT IF EXISTS expression_qa_snapshots_candidate_id_fkey;
ALTER TABLE avatar_studio.expression_qa_snapshots ADD FOREIGN KEY(candidate_id) REFERENCES avatar_studio.expression_candidates(id);
CREATE TABLE IF NOT EXISTS avatar_studio.mouth_calibration_qa (LIKE avatar_studio.body_qa_snapshots INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_qa_id ON avatar_studio.mouth_calibration_qa(id);
ALTER TABLE avatar_studio.mouth_calibration_qa DROP CONSTRAINT IF EXISTS mouth_calibration_qa_candidate_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_qa ADD FOREIGN KEY(candidate_id) REFERENCES avatar_studio.mouth_calibration_candidates(id);

CREATE TABLE IF NOT EXISTS avatar_studio.body_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
 candidate_id uuid NOT NULL REFERENCES avatar_studio.body_reference_candidates(id), qa_snapshot_id uuid,
 action text NOT NULL, rejection_reason text, human_note text, guided_review jsonb NOT NULL, decided_by text NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 CHECK(action IN ('KEEP','REJECT','COMPARE','SUPERSEDE')),
 CHECK(rejection_reason IS NULL OR rejection_reason IN ('IDENTITY_DRIFT','AGE_DRIFT','BODY_BUILD_DRIFT','FACE_CHANGED','NOSE_CHANGED','JAW_CHANGED','HAIR_CHANGED','HAND_FAILURE','FINGER_FAILURE','LIMB_FAILURE','FOOT_FAILURE','POSTURE_FAILURE','SEATED_CONTACT_FAILURE','EXPRESSION_WRONG','EXPRESSION_OVERDONE','TEETH_CHANGED','MOUTH_GEOMETRY_FAILURE','WARDROBE_CONTAMINATION','ACCESSORY_CONTAMINATION','BACKGROUND_ERROR','LIGHTING_ERROR','IMAGE_QUALITY','OTHER')),
 CHECK(action<>'REJECT' OR rejection_reason IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS avatar_studio.expression_review_events (LIKE avatar_studio.body_review_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_review_events_id ON avatar_studio.expression_review_events(id);
ALTER TABLE avatar_studio.expression_review_events DROP CONSTRAINT IF EXISTS expression_review_events_candidate_id_fkey;
ALTER TABLE avatar_studio.expression_review_events ADD FOREIGN KEY(candidate_id) REFERENCES avatar_studio.expression_candidates(id);

CREATE TABLE IF NOT EXISTS avatar_studio.body_reference_certifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, passport_certification_event_id uuid NOT NULL,
 body_build_version_id uuid NOT NULL, candidate_id uuid NOT NULL REFERENCES avatar_studio.body_reference_candidates(id), reference_type text NOT NULL,
 qa_snapshot_id uuid NOT NULL REFERENCES avatar_studio.body_qa_snapshots(id), source_artifact_id text NOT NULL, source_artifact_version integer NOT NULL,
 guided_review jsonb NOT NULL, warnings_acknowledged jsonb NOT NULL, explicit_confirmation boolean NOT NULL,
 certified_by text NOT NULL, certified_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 UNIQUE(body_build_version_id,reference_type), UNIQUE(candidate_id), CHECK(explicit_confirmation=true)
);
CREATE TABLE IF NOT EXISTS avatar_studio.expression_certifications (LIKE avatar_studio.body_reference_certifications INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_certifications_id ON avatar_studio.expression_certifications(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_certifications_type ON avatar_studio.expression_certifications(body_build_version_id,reference_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expression_certifications_candidate ON avatar_studio.expression_certifications(candidate_id);
ALTER TABLE avatar_studio.expression_certifications DROP CONSTRAINT IF EXISTS expression_certifications_candidate_id_fkey;
ALTER TABLE avatar_studio.expression_certifications DROP CONSTRAINT IF EXISTS expression_certifications_qa_snapshot_id_fkey;
ALTER TABLE avatar_studio.expression_certifications ADD FOREIGN KEY(candidate_id) REFERENCES avatar_studio.expression_candidates(id);
ALTER TABLE avatar_studio.expression_certifications ADD FOREIGN KEY(qa_snapshot_id) REFERENCES avatar_studio.expression_qa_snapshots(id);

CREATE TABLE IF NOT EXISTS avatar_studio.mouth_calibration_certifications (LIKE avatar_studio.body_reference_certifications INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_certifications_id ON avatar_studio.mouth_calibration_certifications(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_certifications_type ON avatar_studio.mouth_calibration_certifications(body_build_version_id,reference_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mouth_calibration_certifications_candidate ON avatar_studio.mouth_calibration_certifications(candidate_id);
ALTER TABLE avatar_studio.mouth_calibration_certifications DROP CONSTRAINT IF EXISTS mouth_calibration_certifications_candidate_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_certifications DROP CONSTRAINT IF EXISTS mouth_calibration_certifications_qa_snapshot_id_fkey;
ALTER TABLE avatar_studio.mouth_calibration_certifications ADD FOREIGN KEY(candidate_id) REFERENCES avatar_studio.mouth_calibration_candidates(id);
ALTER TABLE avatar_studio.mouth_calibration_certifications ADD FOREIGN KEY(qa_snapshot_id) REFERENCES avatar_studio.mouth_calibration_qa(id);

CREATE TABLE IF NOT EXISTS avatar_studio.l2_pack_certification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, identity_lock_version_id uuid NOT NULL,
 passport_certification_event_id uuid NOT NULL REFERENCES avatar_studio.passport_certification_events(id), body_build_version_id uuid NOT NULL REFERENCES avatar_studio.body_build_versions(id),
 body_certification_ids jsonb NOT NULL, expression_certification_ids jsonb NOT NULL, qa_snapshot_ids jsonb NOT NULL,
 warnings_acknowledged jsonb NOT NULL, explicit_confirmation boolean NOT NULL, certified_by text NOT NULL, certified_at timestamptz NOT NULL DEFAULT now(),
 provenance jsonb NOT NULL, FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 UNIQUE(identity_version_id,passport_certification_event_id,body_build_version_id), CHECK(explicit_confirmation=true),
 CHECK(jsonb_array_length(body_certification_ids)=3), CHECK(jsonb_array_length(expression_certification_ids)=3)
);

CREATE TABLE IF NOT EXISTS avatar_studio.l2_generation_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, identity_version_id uuid NOT NULL, passport_certification_event_id uuid NOT NULL,
 generation_kind text NOT NULL, generation_spec_id uuid NOT NULL, provider text NOT NULL, model text NOT NULL, adapter_family text NOT NULL,
 capability text NOT NULL, candidate_count integer NOT NULL, total_planned_calls integer NOT NULL, cost_plan jsonb NOT NULL,
 maximum_allowed_cost numeric(14,6) NOT NULL, preflight_snapshot jsonb NOT NULL, preflight_fingerprint text NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(generation_kind IN ('BODY','EXPRESSION','MOUTH')),
 FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS avatar_studio.l2_generation_execution_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.l2_generation_executions(id),
 preflight_fingerprint text NOT NULL, maximum_allowed_cost numeric(14,6) NOT NULL, unknown_cost_acknowledged boolean NOT NULL,
 explicit_confirmation boolean NOT NULL DEFAULT true, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), CHECK(explicit_confirmation=true)
);
CREATE TABLE IF NOT EXISTS avatar_studio.l2_generation_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES avatar_studio.l2_generation_executions(id),
 ordinal integer NOT NULL, request_fingerprint text NOT NULL, idempotency_key text NOT NULL UNIQUE, status text NOT NULL,
 provider_request_id text, failure_classification text, safe_error_message text, provenance jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(execution_id,ordinal)
);
CREATE TABLE IF NOT EXISTS avatar_studio.l2_generation_attempt_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, character_id uuid NOT NULL,
 attempt_id uuid NOT NULL REFERENCES avatar_studio.l2_generation_attempts(id), status text NOT NULL, provider_request_id text,
 failure_classification text, safe_error_message text, response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
 CHECK(status IN ('STARTED','SUCCEEDED','FAILED')), CHECK(failure_classification IS NULL OR failure_classification IN
 ('PROVIDER_CONFIGURATION','PROVIDER_AUTH','PROVIDER_CAPABILITY','PROVIDER_TIMEOUT','PROVIDER_RATE_LIMIT','PROVIDER_REJECTED_INPUT',
  'PROVIDER_OUTPUT_INVALID','ARTIFACT_INGEST_FAILED','SECURITY_REJECTED_OUTPUT','COST_CHANGED','BUDGET_EXCEEDED','CONSENT_INVALIDATED','GATE0_INVALIDATED','UNKNOWN'))
);
CREATE TABLE IF NOT EXISTS avatar_studio.l2_generation_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL, vertical_code text NOT NULL,
 character_id uuid NOT NULL, execution_id uuid NOT NULL REFERENCES avatar_studio.l2_generation_executions(id),
 attempt_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.l2_generation_attempts(id), generation_kind text NOT NULL,
 candidate_id uuid NOT NULL, artifact_id text NOT NULL, artifact_version integer NOT NULL, content_hash text NOT NULL,
 storage_key text NOT NULL, provider_request_id text, provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id), CHECK(generation_kind IN ('BODY','EXPRESSION','MOUTH')),
 CHECK(artifact_version>0)
);

ALTER TABLE avatar_studio.source_asset_roles DROP CONSTRAINT IF EXISTS source_asset_roles_role_check;
ALTER TABLE avatar_studio.source_asset_roles ADD CONSTRAINT source_asset_roles_role_check CHECK(role IN
 ('IDENTITY','PASSPORT_SOURCE','PASSPORT_CANDIDATE','BODY_REFERENCE_CANDIDATE','EXPRESSION_REFERENCE_CANDIDATE',
  'MOUTH_CALIBRATION_CANDIDATE','VOICE_SOURCE','WARDROBE','PRODUCT','LOCATION','STYLE_REFERENCE','PREVIOUS_SHOT'));

CREATE OR REPLACE FUNCTION avatar_studio.enforce_l2_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE avatar_workspace uuid; avatar_vertical text; brand_workspace uuid;
BEGIN
 SELECT workspace_id,vertical_code INTO avatar_workspace,avatar_vertical FROM avatar_studio.characters WHERE id=NEW.character_id;
 SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
 IF avatar_workspace IS NULL OR avatar_workspace<>NEW.workspace_id OR brand_workspace<>NEW.workspace_id
   OR (to_jsonb(NEW)?'vertical_code' AND to_jsonb(NEW)->>'vertical_code'<>avatar_vertical)
   OR NOT EXISTS(SELECT 1 FROM avatar_studio.brand_permissions WHERE character_id=NEW.character_id AND brand_id=NEW.brand_id AND allowed)
 THEN RAISE EXCEPTION 'Avatar Studio L2 workspace/brand/vertical isolation violation'; END IF;
 IF to_jsonb(NEW)?'identity_version_id' AND NOT EXISTS(SELECT 1 FROM avatar_studio.character_versions
   WHERE id=(to_jsonb(NEW)->>'identity_version_id')::uuid AND character_id=NEW.character_id)
 THEN RAISE EXCEPTION 'Avatar Studio L2 identity version isolation violation'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION avatar_studio.enforce_l2_pack_certification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_identity uuid; passport_identity uuid; body_count int; expression_count int; referenced_body_count int; referenced_expression_count int;
BEGIN
 SELECT id INTO current_identity FROM avatar_studio.character_versions WHERE character_id=NEW.character_id ORDER BY version DESC LIMIT 1;
 SELECT identity_version_id INTO passport_identity FROM avatar_studio.passport_certification_events WHERE id=NEW.passport_certification_event_id AND character_id=NEW.character_id;
 IF current_identity IS DISTINCT FROM NEW.identity_version_id OR passport_identity IS DISTINCT FROM NEW.identity_version_id
 THEN RAISE EXCEPTION 'L2 dependency is not current'; END IF;
 SELECT count(DISTINCT reference_type) INTO body_count FROM avatar_studio.body_reference_certifications
  WHERE character_id=NEW.character_id AND identity_version_id=NEW.identity_version_id AND passport_certification_event_id=NEW.passport_certification_event_id
    AND body_build_version_id=NEW.body_build_version_id AND reference_type IN ('CHEST_UP_NEUTRAL','FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL');
 SELECT count(DISTINCT reference_type) INTO expression_count FROM avatar_studio.expression_certifications
  WHERE character_id=NEW.character_id AND identity_version_id=NEW.identity_version_id AND passport_certification_event_id=NEW.passport_certification_event_id
    AND body_build_version_id=NEW.body_build_version_id AND reference_type IN ('NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED');
 IF body_count<>3 OR expression_count<>3 THEN RAISE EXCEPTION 'L2_PACK_INCOMPLETE'; END IF;
 SELECT count(*) INTO referenced_body_count FROM avatar_studio.body_reference_certifications c
  WHERE c.id IN (SELECT value::uuid FROM jsonb_array_elements_text(NEW.body_certification_ids))
    AND c.character_id=NEW.character_id AND c.identity_version_id=NEW.identity_version_id
    AND c.passport_certification_event_id=NEW.passport_certification_event_id AND c.body_build_version_id=NEW.body_build_version_id;
 SELECT count(*) INTO referenced_expression_count FROM avatar_studio.expression_certifications c
  WHERE c.id IN (SELECT value::uuid FROM jsonb_array_elements_text(NEW.expression_certification_ids))
    AND c.character_id=NEW.character_id AND c.identity_version_id=NEW.identity_version_id
    AND c.passport_certification_event_id=NEW.passport_certification_event_id AND c.body_build_version_id=NEW.body_build_version_id
    AND c.reference_type IN ('NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED');
 IF referenced_body_count<>3 OR referenced_expression_count<>3 THEN RAISE EXCEPTION 'L2 certification evidence IDs mismatch'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION avatar_studio.enforce_l2_reference_certification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_table text; qa_table text; review_table text; candidate_identity uuid; candidate_passport uuid;
 candidate_build uuid; candidate_reference text; candidate_artifact text; candidate_artifact_version integer; qa_status text; human_rejected boolean;
BEGIN
 IF TG_TABLE_NAME='body_reference_certifications' THEN candidate_table:='body_reference_candidates';qa_table:='body_qa_snapshots';review_table:='body_review_events';
 ELSIF TG_TABLE_NAME='expression_certifications' THEN candidate_table:='expression_candidates';qa_table:='expression_qa_snapshots';review_table:='expression_review_events';
 ELSE candidate_table:='mouth_calibration_candidates';qa_table:='mouth_calibration_qa';review_table:=NULL; END IF;
 EXECUTE format('SELECT identity_version_id,passport_certification_event_id,body_build_version_id,reference_type,artifact_id,artifact_version FROM avatar_studio.%I WHERE id=$1',candidate_table)
  INTO candidate_identity,candidate_passport,candidate_build,candidate_reference,candidate_artifact,candidate_artifact_version USING NEW.candidate_id;
 EXECUTE format('SELECT status FROM avatar_studio.%I WHERE id=$1 AND candidate_id=$2',qa_table) INTO qa_status USING NEW.qa_snapshot_id,NEW.candidate_id;
 IF candidate_identity IS NULL OR candidate_identity<>NEW.identity_version_id OR candidate_passport<>NEW.passport_certification_event_id
   OR candidate_build<>NEW.body_build_version_id OR candidate_reference<>NEW.reference_type OR candidate_artifact<>NEW.source_artifact_id
   OR candidate_artifact_version<>NEW.source_artifact_version THEN RAISE EXCEPTION 'L2 candidate/certification dependency mismatch'; END IF;
 IF qa_status IS NULL OR qa_status='REJECT' THEN RAISE EXCEPTION 'L2 non-rejected immutable QA required'; END IF;
 IF review_table IS NOT NULL THEN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM avatar_studio.%I WHERE candidate_id=$1 AND action=''REJECT'')',review_table)
    INTO human_rejected USING NEW.candidate_id;
  IF human_rejected THEN RAISE EXCEPTION 'Human-rejected L2 candidate cannot be certified'; END IF;
 END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['body_reference_certifications','expression_certifications','mouth_calibration_certifications'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS %I_human_certification_guard ON avatar_studio.%I',table_name,table_name);
 EXECUTE format('CREATE TRIGGER %I_human_certification_guard BEFORE INSERT ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_l2_reference_certification()',table_name,table_name);
 END LOOP; END $$;
DROP TRIGGER IF EXISTS l2_pack_certification_guard ON avatar_studio.l2_pack_certification_events;
CREATE TRIGGER l2_pack_certification_guard BEFORE INSERT ON avatar_studio.l2_pack_certification_events FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_l2_pack_certification();

DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['body_build_versions','body_generation_specs','body_reference_candidates',
 'body_qa_snapshots','body_review_events','body_reference_certifications','expression_generation_specs','expression_candidates',
 'expression_qa_snapshots','expression_review_events','expression_certifications','mouth_calibration_specs','mouth_calibration_candidates',
 'mouth_calibration_qa','mouth_calibration_certifications','l2_pack_certification_events','l2_generation_executions',
 'l2_generation_attempt_events','l2_generation_results'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS %I_scope_guard ON avatar_studio.%I',table_name,table_name);
 EXECUTE format('CREATE TRIGGER %I_scope_guard BEFORE INSERT ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_l2_scope()',table_name,table_name);
 EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
 EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
 END LOOP; END $$;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['l2_generation_execution_approvals','l2_generation_attempts',
 'l2_generation_attempt_events','l2_generation_results'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
 EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
 END LOOP; END $$;

CREATE OR REPLACE FUNCTION avatar_studio.enforce_level_one_certification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest_identity uuid; latest_lock uuid; has_passport boolean; has_l2 boolean;
BEGIN
 IF NEW.current_level<1 THEN RETURN NEW; END IF;
 SELECT id INTO latest_identity FROM avatar_studio.character_versions WHERE character_id=NEW.character_id ORDER BY version DESC LIMIT 1;
 SELECT id INTO latest_lock FROM avatar_studio.identity_lock_versions WHERE identity_version_id=latest_identity ORDER BY version DESC LIMIT 1;
 SELECT EXISTS(SELECT 1 FROM avatar_studio.passport_certification_events WHERE character_id=NEW.character_id AND identity_version_id=latest_identity AND identity_lock_version_id=latest_lock)
  OR (NOT EXISTS(SELECT 1 FROM avatar_studio.identity_lock_versions WHERE character_id=NEW.character_id)
   AND EXISTS(SELECT 1 FROM avatar_studio.passport_certifications WHERE character_id=NEW.character_id AND decision='CERTIFIED')) INTO has_passport;
 IF NOT has_passport THEN RAISE EXCEPTION 'CERTIFIED_PASSPORT_REQUIRED'; END IF;
 IF NEW.current_level>=2 THEN
  SELECT EXISTS(SELECT 1 FROM avatar_studio.l2_pack_certification_events WHERE character_id=NEW.character_id AND identity_version_id=latest_identity)
   OR (NOT EXISTS(SELECT 1 FROM avatar_studio.body_build_versions WHERE character_id=NEW.character_id)
    AND (SELECT count(DISTINCT kind) FROM avatar_studio.body_references WHERE character_id=NEW.character_id AND approval_status='APPROVED')>=3
    AND (SELECT count(DISTINCT expression) FROM avatar_studio.expression_references WHERE character_id=NEW.character_id AND approval_status='APPROVED')>=3) INTO has_l2;
  IF NOT has_l2 THEN RAISE EXCEPTION 'L2_PACK_HUMAN_CERTIFICATION_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;

COMMIT;
