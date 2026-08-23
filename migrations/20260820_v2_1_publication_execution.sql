BEGIN;

-- Durable publication identity and lifecycle. The unique key is the database-level
-- duplicate-publication guard; provider adapters must also forward this key to
-- external systems that support idempotency.
CREATE TABLE IF NOT EXISTS v2_1.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_version_id uuid NOT NULL,
  destination text NOT NULL,
  publication_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  external_id text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED','FAILED')),
  CHECK (attempt > 0)
);

-- Compatibility with pre-canonical local V2.1 snapshots. CREATE TABLE IF NOT
-- EXISTS does not evolve an existing table, so add the canonical columns
-- explicitly and non-destructively before creating indexes.
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS artifact_version_id uuid;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS publication_key text;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDING';
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS error jsonb DEFAULT '{}'::jsonb;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE v2_1.publications ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Existing legacy rows may legitimately have no canonical publication_key.
-- Preserve them while still enforcing idempotency for all canonical/new rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_publications_publication_key
  ON v2_1.publications(publication_key)
  WHERE publication_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_publications_artifact
  ON v2_1.publications(artifact_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v21_publications_status
  ON v2_1.publications(status, updated_at);

COMMIT;
