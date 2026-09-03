BEGIN;

CREATE TABLE IF NOT EXISTS v2_10.quality_script_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  revision integer NOT NULL CHECK (revision > 0),
  fingerprint text NOT NULL,
  content jsonb NOT NULL,
  validation jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, revision),
  UNIQUE(draft_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS v2_10.quality_storyboard_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  script_revision_id uuid NOT NULL REFERENCES v2_10.quality_script_revisions(id),
  revision integer NOT NULL CHECK (revision > 0),
  fingerprint text NOT NULL,
  content jsonb NOT NULL,
  validation jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, revision),
  UNIQUE(draft_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS v2_10.quality_stage_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES v2_10.creative_drafts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id),
  stage text NOT NULL CHECK (stage IN ('SCRIPT','STORYBOARD','LOOK','PILOT')),
  subject_type text NOT NULL CHECK (subject_type IN ('SCRIPT_REVISION','STORYBOARD_REVISION','KEYFRAME','PILOT_ATTEMPT')),
  subject_id uuid NOT NULL,
  subject_fingerprint text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','INVALIDATED')),
  reason text,
  actor text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quality_stage_approval_latest
  ON v2_10.quality_stage_approval_events(draft_id, stage, decided_at DESC);

CREATE INDEX IF NOT EXISTS quality_script_latest
  ON v2_10.quality_script_revisions(draft_id, revision DESC);

CREATE INDEX IF NOT EXISTS quality_storyboard_latest
  ON v2_10.quality_storyboard_revisions(draft_id, revision DESC);

CREATE UNIQUE INDEX IF NOT EXISTS quality_single_positive_approval
  ON v2_10.quality_stage_approval_events(draft_id, stage, subject_fingerprint)
  WHERE decision='APPROVED';

-- Allow immutable new locked workflows after an approved script/storyboard changes.
-- Historical workflows stay untouched and auditable.
ALTER TABLE v2_10.locked_keyframe_workflows
  ADD COLUMN IF NOT EXISTS draft_revision integer;

UPDATE v2_10.locked_keyframe_workflows w
SET draft_revision = d.revision
FROM v2_10.creative_drafts d
WHERE d.id=w.draft_id AND w.draft_revision IS NULL;

ALTER TABLE v2_10.locked_keyframe_workflows
  ALTER COLUMN draft_revision SET NOT NULL;

ALTER TABLE v2_10.locked_keyframe_workflows
  DROP CONSTRAINT IF EXISTS locked_keyframe_workflows_draft_id_opening_shot_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS locked_keyframe_workflow_intent_unique
  ON v2_10.locked_keyframe_workflows(draft_id, opening_shot_id, canonical_intent_fingerprint);

-- Pilot generation passing semantic QA is not human acceptance.
ALTER TABLE v2_10.locked_keyframe_workflows
  DROP CONSTRAINT IF EXISTS locked_keyframe_workflows_state_check;

ALTER TABLE v2_10.locked_keyframe_workflows
  ADD CONSTRAINT locked_keyframe_workflows_state_check CHECK (state IN (
    'PREPARED','KEYFRAME_READY','AWAITING_HUMAN_APPROVAL','KEYFRAME_APPROVED',
    'FIRST_VIDEO_RUNNING','FIRST_VIDEO_FAILED','FIRST_VIDEO_REVIEW','FIRST_VIDEO_REJECTED',
    'FIRST_VIDEO_ACCEPTED','CONTINUATION_STARTED'
  ));

CREATE OR REPLACE FUNCTION v2_10.protect_locked_keyframe_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.production_id IS DISTINCT FROM OLD.production_id
    OR NEW.opening_shot_id IS DISTINCT FROM OLD.opening_shot_id OR NEW.opening_asset_id IS DISTINCT FROM OLD.opening_asset_id
    OR NEW.canonical_intent_fingerprint IS DISTINCT FROM OLD.canonical_intent_fingerprint
    OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'locked-keyframe workflow identity is immutable';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state='PREPARED' AND NEW.state='KEYFRAME_READY') OR
    (OLD.state='KEYFRAME_READY' AND NEW.state='AWAITING_HUMAN_APPROVAL') OR
    (OLD.state='AWAITING_HUMAN_APPROVAL' AND NEW.state IN ('KEYFRAME_READY','KEYFRAME_APPROVED')) OR
    (OLD.state='KEYFRAME_APPROVED' AND NEW.state IN ('KEYFRAME_READY','FIRST_VIDEO_RUNNING')) OR
    (OLD.state='FIRST_VIDEO_RUNNING' AND NEW.state IN ('FIRST_VIDEO_FAILED','FIRST_VIDEO_REVIEW')) OR
    (OLD.state='FIRST_VIDEO_REVIEW' AND NEW.state IN ('FIRST_VIDEO_ACCEPTED','FIRST_VIDEO_REJECTED')) OR
    (OLD.state='FIRST_VIDEO_REJECTED' AND NEW.state='KEYFRAME_APPROVED') OR
    (OLD.state='FIRST_VIDEO_FAILED' AND NEW.state='KEYFRAME_READY') OR
    (OLD.state='FIRST_VIDEO_ACCEPTED' AND NEW.state='CONTINUATION_STARTED')
  ) THEN RAISE EXCEPTION 'invalid locked-keyframe workflow state transition: % -> %', OLD.state, NEW.state; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION v2_10.protect_quality_director_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'quality director evidence is immutable';
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['quality_script_revisions','quality_storyboard_revisions','quality_stage_approval_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_scope BEFORE INSERT OR UPDATE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.enforce_brand_workspace()', table_name, table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON v2_10.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON v2_10.%I FOR EACH ROW EXECUTE FUNCTION v2_10.protect_quality_director_evidence()', table_name, table_name);
  END LOOP;
END $$;

COMMIT;

-- Forward-only recovery: stop using the QUALITY script-first routes.
-- All script/storyboard revisions and approval/invalidation events remain immutable audit evidence.
