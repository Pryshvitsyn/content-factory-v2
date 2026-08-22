-- V2.3 durable human review for exact immutable master artifacts.
-- Review decisions are append-only and intentionally separate from publication state.
BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_3;

CREATE TABLE IF NOT EXISTS v2_3.master_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE RESTRICT,
  production_id uuid NOT NULL REFERENCES v2_1.productions(id) ON DELETE RESTRICT,
  master_artifact_id text NOT NULL,
  master_artifact_version integer NOT NULL,
  master_storage_key text NOT NULL,
  master_content_hash text NOT NULL,
  content_type text NOT NULL DEFAULT 'video/mp4',
  validation_status text NOT NULL,
  review_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(production_id, master_artifact_id, master_storage_key),
  CHECK (master_artifact_version > 0),
  CHECK (length(trim(master_storage_key)) > 0),
  CHECK (length(trim(master_content_hash)) > 0),
  CHECK (content_type IN ('video/mp4','video/webm')),
  CHECK (validation_status = 'PASS')
);

CREATE TABLE IF NOT EXISTS v2_3.master_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_item_id uuid NOT NULL UNIQUE REFERENCES v2_3.master_review_items(id) ON DELETE RESTRICT,
  decision text NOT NULL,
  actor text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision IN ('APPROVED','REJECTED')),
  CHECK (length(trim(actor)) > 0),
  CHECK (decision <> 'REJECTED' OR length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_v23_review_items_brand
  ON v2_3.master_review_items(brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v23_review_decisions_time
  ON v2_3.master_review_decisions(decided_at DESC);

CREATE OR REPLACE FUNCTION v2_3.enforce_master_review_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE production_workspace_id uuid; production_brand_id uuid; brand_workspace_id uuid;
BEGIN
  SELECT workspace_id, brand_id INTO production_workspace_id, production_brand_id
  FROM v2_1.productions WHERE id = NEW.production_id;
  SELECT workspace_id INTO brand_workspace_id
  FROM v2_2.brands WHERE id = NEW.brand_id;

  IF production_workspace_id IS NULL
     OR production_workspace_id <> NEW.workspace_id
     OR production_brand_id IS NULL
     OR production_brand_id <> NEW.brand_id
     OR brand_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'master review ownership does not match persisted production and brand';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION v2_3.prevent_review_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'human review history is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_v23_master_review_scope ON v2_3.master_review_items;
CREATE TRIGGER trg_v23_master_review_scope
BEFORE INSERT ON v2_3.master_review_items
FOR EACH ROW EXECUTE FUNCTION v2_3.enforce_master_review_scope();

DROP TRIGGER IF EXISTS trg_v23_review_item_immutable ON v2_3.master_review_items;
CREATE TRIGGER trg_v23_review_item_immutable
BEFORE UPDATE OR DELETE ON v2_3.master_review_items
FOR EACH ROW EXECUTE FUNCTION v2_3.prevent_review_history_mutation();

DROP TRIGGER IF EXISTS trg_v23_review_decision_immutable ON v2_3.master_review_decisions;
CREATE TRIGGER trg_v23_review_decision_immutable
BEFORE UPDATE OR DELETE ON v2_3.master_review_decisions
FOR EACH ROW EXECUTE FUNCTION v2_3.prevent_review_history_mutation();

COMMIT;
