BEGIN;
CREATE TABLE IF NOT EXISTS avatar_studio.source_viewpoint_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL, brand_id uuid NOT NULL,
  source_asset_id uuid NOT NULL REFERENCES avatar_studio.source_assets(id) ON DELETE CASCADE,
  classification_type text NOT NULL DEFAULT 'IDENTITY_VIEWPOINT',
  viewpoint text NOT NULL CHECK (viewpoint IN ('FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT','PROFILE_LEFT','PROFILE_RIGHT','OTHER','UNKNOWN')),
  human_approved boolean NOT NULL CHECK (human_approved), provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_avatar_source_viewpoint_latest ON avatar_studio.source_viewpoint_classifications(source_asset_id,created_at DESC,id DESC);
CREATE OR REPLACE FUNCTION avatar_studio.enforce_source_viewpoint_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row avatar_studio.source_assets%ROWTYPE;
BEGIN SELECT * INTO source_row FROM avatar_studio.source_assets WHERE id=NEW.source_asset_id;
  IF source_row.id IS NULL OR source_row.workspace_id<>NEW.workspace_id OR source_row.character_id<>NEW.character_id OR source_row.brand_id<>NEW.brand_id THEN RAISE EXCEPTION 'Avatar Studio source viewpoint scope violation'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS avatar_source_viewpoint_scope_guard ON avatar_studio.source_viewpoint_classifications;
CREATE TRIGGER avatar_source_viewpoint_scope_guard BEFORE INSERT OR UPDATE ON avatar_studio.source_viewpoint_classifications FOR EACH ROW EXECUTE FUNCTION avatar_studio.enforce_source_viewpoint_scope();
DROP TRIGGER IF EXISTS avatar_source_viewpoint_immutable_change ON avatar_studio.source_viewpoint_classifications;
CREATE TRIGGER avatar_source_viewpoint_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.source_viewpoint_classifications FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
COMMIT;
