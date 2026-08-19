BEGIN;

-- V2.1 concurrency certification contract.
-- The claim functions use row-level locking with SKIP LOCKED so concurrent
-- workers cannot own the same queued job or runnable stage attempt.
-- This migration adds an explicit audit record for certification runs.
CREATE TABLE IF NOT EXISTS v2_1.concurrency_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  subject_id uuid NOT NULL,
  contender_count integer NOT NULL,
  successful_claims integer NOT NULL,
  certified boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v21_concurrency_certifications_subject
  ON v2_1.concurrency_certifications(subject_id, created_at DESC);

COMMIT;
