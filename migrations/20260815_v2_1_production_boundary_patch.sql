-- Patch for the V2.1 production boundary.
-- Kept separate so the boundary migration remains readable and rerunnable in order.

ALTER TABLE v2_1.production_requests
  ADD COLUMN IF NOT EXISTS production_id uuid REFERENCES v2_1.productions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_v21_production_requests_production
  ON v2_1.production_requests(production_id)
  WHERE production_id IS NOT NULL;
