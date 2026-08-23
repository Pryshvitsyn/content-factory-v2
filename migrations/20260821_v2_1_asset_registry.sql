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

-- Compatibility with older local V2.1 snapshots. Evolve only by adding missing
-- columns; do not rewrite or delete any existing rows.
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS production_id uuid REFERENCES v2_1.productions(id) ON DELETE CASCADE;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS asset_id text;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS semantic_key text;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS artifact_storage_key text;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS artifact_version integer;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS status text DEFAULT 'READY';
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE v2_1.asset_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Preserve incomplete legacy rows while protecting canonical/new rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_asset_registry_production_asset
  ON v2_1.asset_registry(production_id, asset_id)
  WHERE production_id IS NOT NULL AND asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_asset_registry_reuse
  ON v2_1.asset_registry(asset_id, kind, status, created_at DESC);

COMMIT;
