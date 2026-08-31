-- Avatar Studio V1 first slice.
-- Adds portfolio verticals and durable avatar state without changing certified V2 execution tables.
BEGIN;

CREATE SCHEMA IF NOT EXISTS avatar_studio;

CREATE TABLE IF NOT EXISTS avatar_studio.audience_verticals (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code IN ('PSYCHOLOGY_WELLBEING','CONSTRUCTION_RENOVATION','LUXURY_LIFESTYLE','TRAVEL')),
  CHECK (status IN ('ACTIVE','PAUSED'))
);

INSERT INTO avatar_studio.audience_verticals(code,display_name) VALUES
  ('PSYCHOLOGY_WELLBEING','Psychology & Wellbeing'),
  ('CONSTRUCTION_RENOVATION','Construction & Renovation'),
  ('LUXURY_LIFESTYLE','Luxury Lifestyle'),
  ('TRAVEL','Travel')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS avatar_studio.brand_verticals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id uuid PRIMARY KEY REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,brand_id,vertical_code)
);

CREATE TABLE IF NOT EXISTS avatar_studio.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  internal_name text NOT NULL,
  subject_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_type IN ('SYNTHETIC','FOUNDER','CONSENTED_REAL_PERSON','APPROVED_CHARACTER')),
  CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  CHECK (length(trim(internal_name)) > 0),
  UNIQUE(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS avatar_studio.character_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  version integer NOT NULL,
  identity_spec jsonb NOT NULL,
  identity_hash text NOT NULL,
  provenance jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  UNIQUE(character_id,version),
  CHECK (version > 0),
  CHECK (NOT (identity_spec ?| ARRAY['wardrobe','clothing','accessories','props','environment','background']))
);

CREATE TABLE IF NOT EXISTS avatar_studio.brand_permissions (
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(character_id,brand_id),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS avatar_studio.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  scope text NOT NULL,
  status text NOT NULL,
  rights_basis text NOT NULL,
  evidence_artifact_id text,
  evidence_artifact_version integer,
  restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (scope IN ('FACE','VOICE','FACE_AND_VOICE','SYNTHETIC_IDENTITY')),
  CHECK (status IN ('APPROVED','REVIEW','REVOKED','EXPIRED')),
  CHECK (evidence_artifact_version IS NULL OR evidence_artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.source_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  source_type text NOT NULL,
  source_locator text,
  artifact_id text,
  artifact_version integer,
  content_hash text,
  gate0_status text NOT NULL,
  gate0_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL,
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (source_type IN ('FILE','URL','TRANSCRIPT','IMAGE','VIDEO','PROMPT','REPOSITORY','PDF','METADATA','SOCIAL_REFERENCE','SYNTHETIC_TRAITS')),
  CHECK (gate0_status IN ('PASS','REVIEW','BLOCK')),
  CHECK (artifact_version IS NULL OR artifact_version > 0),
  CHECK (source_locator IS NOT NULL OR artifact_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  candidate_no integer NOT NULL,
  source_asset_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id),
  qa jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_by text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  UNIQUE(character_id,candidate_no),
  CHECK (candidate_no > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id uuid NOT NULL REFERENCES avatar_studio.passports(id) ON DELETE CASCADE,
  angle text NOT NULL,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  content_hash text,
  reference_geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(passport_id,angle),
  CHECK (angle IN ('FRONTAL','THREE_QUARTER_45','PROFILE_90')),
  CHECK (artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.passport_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  character_id uuid NOT NULL,
  passport_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.passports(id),
  decision text NOT NULL,
  approval_notes text,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (decision IN ('CERTIFIED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.body_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  kind text NOT NULL, artifact_id text NOT NULL, artifact_version integer NOT NULL, approval_status text NOT NULL,
  provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (kind IN ('CHEST_UP','FULL_BODY_STANDING','SEATED')), CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')),
  CHECK (artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.expression_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  expression text NOT NULL, artifact_id text NOT NULL, artifact_version integer NOT NULL, approval_status text NOT NULL,
  provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (expression IN ('NEUTRAL','WARM_SMILE','CONCERNED_SERIOUS','ENERGETIC')), CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')),
  CHECK (artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.wardrobe_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  name text NOT NULL, clothing_description text NOT NULL, footwear text, accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_brand_ids jsonb NOT NULL DEFAULT '[]'::jsonb, allowed_verticals jsonb NOT NULL DEFAULT '[]'::jsonb,
  prohibited_combinations jsonb NOT NULL DEFAULT '[]'::jsonb, reference_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL, provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')), CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  name text NOT NULL, source_type text NOT NULL, language text NOT NULL, source_artifact_id text,
  source_artifact_version integer, consent_record_id uuid REFERENCES avatar_studio.consent_records(id),
  delivery_presets jsonb NOT NULL DEFAULT '[]'::jsonb, approval_status text NOT NULL, provenance jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (source_type IN ('SYNTHETIC','OWNED_RECORDING','CONSENTED_CLONE')),
  CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')), CHECK (source_artifact_version IS NULL OR source_artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.location_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  name text NOT NULL, environment_artifact_id text NOT NULL, environment_artifact_version integer NOT NULL,
  perspective jsonb NOT NULL, camera_height text NOT NULL, lens_character text NOT NULL,
  lighting_direction text NOT NULL, lighting_temperature text NOT NULL, time_of_day text,
  reference_geometry jsonb NOT NULL, key_geometry_objects jsonb NOT NULL DEFAULT '[]'::jsonb,
  rights_provenance jsonb NOT NULL, allowed_verticals jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')), CHECK (environment_artifact_version > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.performance_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  preset text NOT NULL, motion_spec jsonb NOT NULL, failure_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL, provenance jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  UNIQUE(character_id,preset),
  CHECK (preset IN ('CALM_EXPERT','ENERGETIC_WARM','QUIET_FRIENDLY','FIRM_DIRECT','WALKING_VLOGGER','PRODUCT_DEMO','REACTION')),
  CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.continuity_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  continuity_snapshot_id uuid REFERENCES continuity_snapshots(id),
  identity_status text NOT NULL, wardrobe_status text NOT NULL, prop_status text NOT NULL,
  location_status text NOT NULL, geometry_status text NOT NULL, voice_status text NOT NULL, lip_sync_status text NOT NULL,
  evidence jsonb NOT NULL, approval_status text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (identity_status IN ('PASS','FAIL')), CHECK (wardrobe_status IN ('PASS','FAIL')),
  CHECK (prop_status IN ('PASS','FAIL')), CHECK (location_status IN ('PASS','FAIL')),
  CHECK (geometry_status IN ('PASS','FAIL')), CHECK (voice_status IN ('PASS','FAIL')),
  CHECK (lip_sync_status IN ('PASS','FAIL')), CHECK (approval_status IN ('APPROVED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.level_states (
  workspace_id uuid NOT NULL, character_id uuid PRIMARY KEY, current_level integer NOT NULL DEFAULT 0,
  level_name text NOT NULL DEFAULT 'IDENTITY', completed_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_requirements jsonb NOT NULL DEFAULT '[]'::jsonb, blocking_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (current_level BETWEEN 0 AND 7)
);

CREATE TABLE IF NOT EXISTS avatar_studio.test_content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  character_id uuid NOT NULL, vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  format text NOT NULL, reference_source_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id),
  script jsonb NOT NULL, shot_plan jsonb NOT NULL, compiled_provider_plan jsonb NOT NULL,
  plan_fingerprint text NOT NULL, external_call_count integer NOT NULL DEFAULT 0, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE,
  CHECK (format IN ('STATIC_PORTRAIT','TALKING_HEAD','MULTI_SHOT')),
  CHECK (external_call_count = 0), UNIQUE(workspace_id,plan_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_avatar_characters_vertical ON avatar_studio.characters(workspace_id,vertical_code,status);
CREATE INDEX IF NOT EXISTS idx_avatar_permissions_brand ON avatar_studio.brand_permissions(workspace_id,brand_id,allowed);
CREATE INDEX IF NOT EXISTS idx_avatar_sources_character ON avatar_studio.source_assets(character_id,imported_at);
CREATE INDEX IF NOT EXISTS idx_avatar_passports_character ON avatar_studio.passports(character_id,candidate_no);

CREATE OR REPLACE FUNCTION avatar_studio.enforce_brand_vertical_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE brand_workspace uuid; brand_vertical text; avatar_workspace uuid; avatar_vertical text;
BEGIN
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  IF brand_workspace IS NULL OR brand_workspace<>NEW.workspace_id THEN
    RAISE EXCEPTION 'Avatar Studio brand/workspace isolation violation';
  END IF;
  IF TG_TABLE_NAME='brand_verticals' THEN RETURN NEW; END IF;
  SELECT workspace_id,vertical_code INTO avatar_workspace,avatar_vertical FROM avatar_studio.characters WHERE id=NEW.character_id;
  SELECT vertical_code INTO brand_vertical FROM avatar_studio.brand_verticals WHERE brand_id=NEW.brand_id;
  IF avatar_workspace IS NULL OR avatar_workspace<>NEW.workspace_id OR brand_vertical IS NULL OR brand_vertical<>avatar_vertical THEN
    RAISE EXCEPTION 'Avatar Studio brand/vertical isolation violation';
  END IF;
  IF TG_TABLE_NAME='test_content_plans' AND (to_jsonb(NEW)->>'vertical_code')<>avatar_vertical THEN
    RAISE EXCEPTION 'Avatar Studio plan/vertical isolation violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS brand_vertical_scope_guard ON avatar_studio.brand_verticals;
CREATE TRIGGER brand_vertical_scope_guard BEFORE INSERT OR UPDATE ON avatar_studio.brand_verticals
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_brand_vertical_scope();
DROP TRIGGER IF EXISTS avatar_brand_permission_scope_guard ON avatar_studio.brand_permissions;
CREATE TRIGGER avatar_brand_permission_scope_guard BEFORE INSERT OR UPDATE ON avatar_studio.brand_permissions
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_brand_vertical_scope();
DROP TRIGGER IF EXISTS avatar_test_plan_scope_guard ON avatar_studio.test_content_plans;
CREATE TRIGGER avatar_test_plan_scope_guard BEFORE INSERT OR UPDATE ON avatar_studio.test_content_plans
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_brand_vertical_scope();

CREATE OR REPLACE FUNCTION avatar_studio.reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Avatar Studio evidence rows are immutable; create a new version or decision'; END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['character_versions','consent_records','source_assets','passport_panels',
    'passport_certifications','body_references','expression_references','test_content_plans'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
  END LOOP;
END $$;

COMMIT;

-- Forward-only recovery: disable Avatar Studio routes. Immutable identity, consent, source,
-- passport, reference and plan evidence must be retained and must never be rewritten.
