BEGIN;

ALTER TABLE v2_1.publications
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN IF NOT EXISTS publication_id uuid,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS production_run_id uuid,
  ADD COLUMN IF NOT EXISTS pipeline_run_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS last_error_code text;

UPDATE v2_1.publications
SET publication_id = COALESCE(publication_id, id),
    execution_status = CASE status
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'PUBLISHING' THEN 'EXECUTING'
      WHEN 'PUBLISHED' THEN 'SUCCEEDED'
      WHEN 'FAILED' THEN 'FAILED'
      ELSE 'PENDING'
    END,
    delivery_state = CASE status
      WHEN 'PUBLISHED' THEN 'CONFIRMED'
      WHEN 'PUBLISHING' THEN 'UNKNOWN'
      ELSE 'NOT_SENT'
    END
WHERE publication_id IS NULL OR execution_status IS NULL OR delivery_state IS NULL;

ALTER TABLE v2_1.publications
  ALTER COLUMN publication_id SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_publications_publication_id
  ON v2_1.publications(publication_id);

CREATE INDEX IF NOT EXISTS idx_v21_publications_schedule
  ON v2_1.publications(scheduled_at, execution_status)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v21_publications_correlation
  ON v2_1.publications(correlation_id);

CREATE TABLE IF NOT EXISTS v2_1.publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT 'system',
  worker_id text,
  attempt integer NOT NULL DEFAULT 1,
  provider text,
  provider_request_id text,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (attempt > 0)
);

CREATE INDEX IF NOT EXISTS idx_v21_publication_events_publication
  ON v2_1.publication_events(publication_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_v21_publication_events_correlation
  ON v2_1.publication_events(correlation_id, occurred_at);

COMMIT;
