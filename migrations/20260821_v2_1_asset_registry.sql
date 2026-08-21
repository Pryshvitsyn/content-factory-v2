BEGIN;

CREATE TABLE IF NOT EXISTS v2_1.asset_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES v2_1.productions(id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  kind text NOT NULL,
  semantic_key text NOT NULL,
  artifact_storage_key text NOT NULL,
  artifact_version integer NOT NULL,
  status text NOT NULL DEFAULT 'READY',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('READY','INVALID','ARCHIVED')),
  CHECK (artifact_version > 0),
  UNIQUE (production_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_v21_asset_registry_reuse
  ON v2_1.asset_registry(asset_id, kind, status, created_at DESC);

COMMIT;
