BEGIN;

-- Append-only event history can approve the same subject again AFTER invalidation.
-- Legacy events stay at cycle zero; no historical evidence is rewritten.
ALTER TABLE v2_10.quality_stage_approval_events
  ADD COLUMN IF NOT EXISTS approval_cycle bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION v2_10.assign_quality_approval_cycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_event v2_10.quality_stage_approval_events%ROWTYPE;
BEGIN
  PERFORM id FROM v2_10.creative_drafts
    WHERE id=NEW.draft_id AND workspace_id=NEW.workspace_id AND brand_id=NEW.brand_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval draft scope mismatch'; END IF;

  SELECT * INTO previous_event FROM v2_10.quality_stage_approval_events
    WHERE draft_id=NEW.draft_id AND workspace_id=NEW.workspace_id
      AND brand_id=NEW.brand_id AND stage=NEW.stage
    ORDER BY decided_at DESC,id DESC LIMIT 1;

  IF FOUND THEN
    IF previous_event.decision='APPROVED' AND NEW.decision='APPROVED'
      AND previous_event.subject_fingerprint=NEW.subject_fingerprint THEN
      -- Direct duplicate inserts are still rejected by the unique index.
      NEW.approval_cycle := previous_event.approval_cycle;
    ELSE
      NEW.approval_cycle := previous_event.approval_cycle + 1;
    END IF;
    NEW.decided_at := greatest(clock_timestamp(), previous_event.decided_at + interval '1 microsecond');
  ELSE
    NEW.approval_cycle := 0;
    NEW.decided_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS quality_approval_cycle ON v2_10.quality_stage_approval_events;
CREATE TRIGGER quality_approval_cycle BEFORE INSERT ON v2_10.quality_stage_approval_events
  FOR EACH ROW EXECUTE FUNCTION v2_10.assign_quality_approval_cycle();

-- Keep the index name: older repeatable startup migrations use IF NOT EXISTS.
DROP INDEX IF EXISTS v2_10.quality_single_positive_approval;
CREATE UNIQUE INDEX quality_single_positive_approval
  ON v2_10.quality_stage_approval_events(draft_id,stage,subject_fingerprint,approval_cycle)
  WHERE decision='APPROVED';
COMMIT;

-- Forward recovery only after reapproval exists: retain this index/trigger and
-- immutable events. Never restore the lifetime-unique index by deleting history.
-- On application rollback stop the dashboard until a compatible writer is restored.
