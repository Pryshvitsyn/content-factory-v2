BEGIN;
CREATE TABLE IF NOT EXISTS avatar_studio.identity_intake_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, brand_id uuid NOT NULL,
  character_id uuid NOT NULL, identity_version_id uuid NULL, confirmation_text text NOT NULL,
  confirmed_by text NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(), provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_identity_intake_confirmations_current ON avatar_studio.identity_intake_confirmations(character_id,brand_id,confirmed_at DESC,id DESC);
DROP TRIGGER IF EXISTS avatar_identity_intake_confirmation_immutable ON avatar_studio.identity_intake_confirmations;
CREATE TRIGGER avatar_identity_intake_confirmation_immutable BEFORE UPDATE OR DELETE ON avatar_studio.identity_intake_confirmations FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
COMMIT;
