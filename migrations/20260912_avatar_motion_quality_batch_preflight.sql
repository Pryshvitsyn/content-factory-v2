-- Immutable zero-call snapshots bind a Quality Batch approval to the exact
-- provider inputs and local QA evidence inspected before any paid child call.
CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_quality_batch_preflights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_quality_batches(id),
  revision integer NOT NULL CHECK(revision > 0),
  status text NOT NULL CHECK(status IN ('READY','BLOCKED')),
  snapshot jsonb NOT NULL,
  snapshot_fingerprint text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,revision)
);
CREATE INDEX IF NOT EXISTS motion_pilot_batch_preflight_latest_idx
  ON avatar_studio.motion_pilot_quality_batch_preflights(batch_id,revision DESC);

CREATE TABLE IF NOT EXISTS avatar_studio.motion_pilot_quality_batch_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES avatar_studio.motion_pilot_quality_batches(id),
  preflight_id uuid NOT NULL UNIQUE REFERENCES avatar_studio.motion_pilot_quality_batch_preflights(id),
  preflight_fingerprint text NOT NULL,
  approval_scope jsonb NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='motion_pilot_quality_batch_preflights_immutable_change'
      AND tgrelid='avatar_studio.motion_pilot_quality_batch_preflights'::regclass
  ) THEN
    CREATE TRIGGER motion_pilot_quality_batch_preflights_immutable_change
      BEFORE UPDATE OR DELETE ON avatar_studio.motion_pilot_quality_batch_preflights
      FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='motion_pilot_quality_batch_approvals_immutable_change'
      AND tgrelid='avatar_studio.motion_pilot_quality_batch_approvals'::regclass
  ) THEN
    CREATE TRIGGER motion_pilot_quality_batch_approvals_immutable_change
      BEFORE UPDATE OR DELETE ON avatar_studio.motion_pilot_quality_batch_approvals
      FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
  END IF;
END $$;
