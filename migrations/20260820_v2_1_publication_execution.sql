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

CREATE INDEX IF NOT EXISTS idx_v21_publications_artifact
  ON v2_1.publications(artifact_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v21_publications_status
  ON v2_1.publications(status, updated_at);

COMMIT;
