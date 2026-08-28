-- V2.9.2.3 legacy recovery-state repair.
--
-- A previous semantic-recovery runtime could mark a voice execution as
-- NEEDS_RECONCILIATION after the local plan-only adapter threw before any
-- provider HTTP request was possible. Those rows are provably safe to retry
-- only when all provider/artifact evidence is absent and the exact historical
-- local error is present.
--
-- This migration is intentionally narrow and idempotent. It does not touch
-- genuinely ambiguous provider executions.

BEGIN;

UPDATE v2_5.media_executions
SET status = 'RETRYABLE',
    worker_id = NULL,
    error = jsonb_build_object(
      'code', 'LOCAL_PRE_PROVIDER_FAILURE_RECLASSIFIED',
      'message', 'Legacy plan-only adapter failure occurred before provider invocation; safe retry is allowed.',
      'previousStatus', 'NEEDS_RECONCILIATION',
      'previousError', error,
      'reconciledAt', now()
    ),
    updated_at = now()
WHERE status = 'NEEDS_RECONCILIATION'
  AND kind = 'voice'
  AND provider_request_id IS NULL
  AND provider_status IS NULL
  AND artifact_id IS NULL
  AND artifact_version IS NULL
  AND artifact_storage_key IS NULL
  AND artifact_content_hash IS NULL
  AND error->>'code' = 'MEDIA_EXECUTION_FAILED'
  AND error->>'message' = 'Plan-only adapter cannot invoke a provider';

COMMIT;
