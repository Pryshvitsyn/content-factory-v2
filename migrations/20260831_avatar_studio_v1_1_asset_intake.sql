-- Avatar Studio V1.1: immutable asset intake, Gate 0 review and consent events.
-- Forward-only recovery: disable the V1.1 routes; retain all evidence and artifacts.
BEGIN;

CREATE TABLE IF NOT EXISTS avatar_studio.asset_intakes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  vertical_code text NOT NULL REFERENCES avatar_studio.audience_verticals(code),
  character_id uuid NOT NULL,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  artifact_storage_key text NOT NULL,
  content_hash text NOT NULL,
  immutable_version integer NOT NULL DEFAULT 1,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  extension text NOT NULL,
  byte_size bigint NOT NULL,
  width integer,
  height integer,
  duration_ms integer,
  source_type text NOT NULL,
  source_locator text,
  existing_asset_registry_id uuid REFERENCES v2_1.asset_registry(id),
  gate0_status text NOT NULL,
  gate0_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate0_policy_version text NOT NULL,
  rights_status text NOT NULL DEFAULT 'UNKNOWN',
  provenance jsonb NOT NULL,
  uploader text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  UNIQUE(workspace_id,brand_id,artifact_id,artifact_version),
  CHECK (artifact_version > 0 AND immutable_version > 0 AND byte_size > 0),
  CHECK (width IS NULL OR width > 0),
  CHECK (height IS NULL OR height > 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (source_type IN ('UPLOAD','CAMERA','MICROPHONE','EXISTING_ASSET','SAFE_URL_IMPORT')),
  CHECK (gate0_status IN ('PASS','REVIEW','BLOCK')),
  CHECK (rights_status IN ('NOT_REQUIRED','UNKNOWN','VERIFIED','REVOKED'))
);

CREATE TABLE IF NOT EXISTS avatar_studio.gate0_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  intake_asset_id uuid NOT NULL REFERENCES avatar_studio.asset_intakes(id),
  action text NOT NULL,
  reason text NOT NULL,
  findings_snapshot jsonb NOT NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action IN ('APPROVE_FOR_USE','REJECT','REQUEST_CONSENT','MARK_RIGHTS_VERIFIED','KEEP_BLOCKED')),
  CHECK (length(trim(reason)) > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.consent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  intake_asset_id uuid REFERENCES avatar_studio.asset_intakes(id),
  modality text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  disclosure_text text NOT NULL,
  requested_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (modality IN ('FACE','VOICE')),
  CHECK (length(trim(disclosure_text)) > 0)
);

CREATE TABLE IF NOT EXISTS avatar_studio.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  character_id uuid NOT NULL,
  intake_asset_id uuid REFERENCES avatar_studio.asset_intakes(id),
  consent_request_id uuid REFERENCES avatar_studio.consent_requests(id),
  modality text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  subject_identity jsonb NOT NULL,
  rights_basis text NOT NULL,
  allowed_brand_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_verticals jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_use_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_artifact_id text,
  evidence_artifact_version integer,
  evidence_notes text,
  expires_at timestamptz,
  supersedes_event_id uuid REFERENCES avatar_studio.consent_events(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK (modality IN ('FACE','VOICE')),
  CHECK (event_type IN ('REQUEST','GRANT','REVOKE','EXPIRE')),
  CHECK (status IN ('PENDING','APPROVED','REVOKED','EXPIRED')),
  CHECK (evidence_artifact_version IS NULL OR evidence_artifact_version > 0),
  CHECK (length(trim(rights_basis)) > 0)
);

ALTER TABLE avatar_studio.source_assets
  ADD COLUMN IF NOT EXISTS intake_asset_id uuid REFERENCES avatar_studio.asset_intakes(id),
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES v2_2.brands(id);

ALTER TABLE avatar_studio.source_assets DROP CONSTRAINT IF EXISTS source_assets_source_type_check;
ALTER TABLE avatar_studio.source_assets ADD CONSTRAINT source_assets_source_type_check CHECK
  (source_type IN ('FILE','URL','TRANSCRIPT','IMAGE','VIDEO','AUDIO','PROMPT','REPOSITORY','EXISTING_ARTIFACT','PDF','METADATA','SOCIAL_REFERENCE','SYNTHETIC_TRAITS'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_avatar_source_intake
  ON avatar_studio.source_assets(intake_asset_id) WHERE intake_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS avatar_studio.source_asset_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id),
  role text NOT NULL,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_asset_id,role),
  CHECK (role IN ('IDENTITY','PASSPORT_SOURCE','VOICE_SOURCE','WARDROBE','PRODUCT','LOCATION','STYLE_REFERENCE','PREVIOUS_SHOT'))
);

ALTER TABLE avatar_studio.voice_profiles
  ADD COLUMN IF NOT EXISTS consent_event_id uuid REFERENCES avatar_studio.consent_events(id);

CREATE INDEX IF NOT EXISTS idx_avatar_intakes_review
  ON avatar_studio.asset_intakes(workspace_id,brand_id,gate0_status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_consent_effective
  ON avatar_studio.consent_events(character_id,intake_asset_id,modality,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_review_events_asset
  ON avatar_studio.gate0_review_events(intake_asset_id,decided_at DESC);

CREATE OR REPLACE FUNCTION avatar_studio.enforce_intake_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE avatar_workspace uuid; avatar_vertical text; brand_workspace uuid; permission_exists boolean;
BEGIN
  SELECT workspace_id,vertical_code INTO avatar_workspace,avatar_vertical
    FROM avatar_studio.characters WHERE id=NEW.character_id;
  SELECT workspace_id INTO brand_workspace FROM v2_2.brands WHERE id=NEW.brand_id;
  SELECT EXISTS(SELECT 1 FROM avatar_studio.brand_permissions
    WHERE character_id=NEW.character_id AND brand_id=NEW.brand_id AND allowed) INTO permission_exists;
  IF avatar_workspace IS NULL OR avatar_workspace<>NEW.workspace_id OR brand_workspace<>NEW.workspace_id
    OR avatar_vertical<>NEW.vertical_code OR NOT permission_exists THEN
    RAISE EXCEPTION 'Avatar Studio intake workspace/brand/vertical isolation violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS avatar_intake_scope_guard ON avatar_studio.asset_intakes;
CREATE TRIGGER avatar_intake_scope_guard BEFORE INSERT ON avatar_studio.asset_intakes
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_intake_scope();

CREATE OR REPLACE FUNCTION avatar_studio.enforce_avatar_event_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_workspace uuid; parent_brand uuid; parent_character uuid;
BEGIN
  IF TG_TABLE_NAME='gate0_review_events' THEN
    SELECT workspace_id,brand_id,character_id INTO parent_workspace,parent_brand,parent_character
      FROM avatar_studio.asset_intakes WHERE id=NEW.intake_asset_id;
  ELSE
    SELECT workspace_id,brand_id,character_id INTO parent_workspace,parent_brand,parent_character
      FROM avatar_studio.asset_intakes WHERE id=NEW.intake_asset_id;
    IF NEW.intake_asset_id IS NULL THEN
      parent_workspace:=NEW.workspace_id; parent_brand:=NEW.brand_id; parent_character:=NEW.character_id;
    END IF;
  END IF;
  IF parent_workspace IS NULL OR parent_workspace<>NEW.workspace_id OR parent_brand<>NEW.brand_id
    OR (to_jsonb(NEW) ? 'character_id' AND parent_character<>(to_jsonb(NEW)->>'character_id')::uuid) THEN
    RAISE EXCEPTION 'Avatar Studio review/consent event scope violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS avatar_gate_review_scope_guard ON avatar_studio.gate0_review_events;
CREATE TRIGGER avatar_gate_review_scope_guard BEFORE INSERT ON avatar_studio.gate0_review_events
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_avatar_event_scope();
DROP TRIGGER IF EXISTS avatar_consent_event_scope_guard ON avatar_studio.consent_events;
CREATE TRIGGER avatar_consent_event_scope_guard BEFORE INSERT ON avatar_studio.consent_events
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_avatar_event_scope();
DROP TRIGGER IF EXISTS avatar_consent_request_scope_guard ON avatar_studio.consent_requests;
CREATE TRIGGER avatar_consent_request_scope_guard BEFORE INSERT ON avatar_studio.consent_requests
FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_avatar_event_scope();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['asset_intakes','gate0_review_events','consent_requests','consent_events','source_asset_roles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable_change ON avatar_studio.%I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.%I FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change()',table_name,table_name);
  END LOOP;
END $$;

COMMIT;
