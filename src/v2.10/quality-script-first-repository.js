'use strict';

const { QualityScriptFirstPostgresRepository } = require('./quality-script-first-postgres-repository');

const SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES = Object.freeze([
  'KEYFRAME_GEOMETRY_MISMATCH',
  'KEYFRAME_TYPE_UNSUPPORTED',
  'KEYFRAME_SIZE_INVALID',
]);
const SAFE_LOCAL_FIRST_VIDEO_RETRY_CODES = Object.freeze([
  'V210_EXECUTION_DISABLED',
  'LIVE_REPLICATE_TOKEN_REQUIRED',
  'CREDENTIALS_MISSING',
  'V210_CREDENTIALS_MISSING',
]);
const LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR = 'Unsupported quality tier QUALITY';
const LEGACY_PRE_REQUEST_FIRST_VIDEO_ERROR = Object.freeze({
  code: 'FIRST_VIDEO_STAGE_FAILED',
  message: 'Seedance 2.5 duration must be 1-30 seconds',
});
const TERMINAL_FIRST_VIDEO_PROVIDER_FAILURE_CODES = Object.freeze([
  'REPLICATE_PREDICTION_FAILED',
  'REPLICATE_PREDICTION_CANCELED',
]);

function lockedStageConflict(message = 'This immutable stage preflight already has an active, failed, or ambiguous attempt') {
  return Object.assign(new Error(message), { code: 'LOCKED_STAGE_ALREADY_ATTEMPTED', status: 409 });
}

function isKnownPreRequestSemanticTierFailure(attempt, stage) {
  return stage === 'KEYFRAME'
    && attempt?.status === 'NEEDS_RECONCILIATION'
    && attempt?.boundary_state === 'MAY_HAVE_STARTED'
    && !attempt?.provider_request_id
    && attempt?.error?.code === 'KEYFRAME_STAGE_FAILED'
    && attempt?.error?.message === LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR;
}

function isKnownPreRequestFirstVideoFailure(attempt, stage) {
  return stage === 'FIRST_VIDEO'
    && attempt?.status === 'NEEDS_RECONCILIATION'
    && attempt?.boundary_state === 'MAY_HAVE_STARTED'
    && !attempt?.provider_request_id
    && attempt?.error?.code === LEGACY_PRE_REQUEST_FIRST_VIDEO_ERROR.code
    && attempt?.error?.message === LEGACY_PRE_REQUEST_FIRST_VIDEO_ERROR.message;
}

function isKnownPreRequestValidationFailure(attempt, stage) {
  return isKnownPreRequestSemanticTierFailure(attempt, stage)
    || isKnownPreRequestFirstVideoFailure(attempt, stage);
}

function isKnownTerminalFirstVideoProviderFailure(attempt, stage) {
  return stage === 'FIRST_VIDEO'
    && attempt?.status === 'NEEDS_RECONCILIATION'
    && attempt?.boundary_state === 'MAY_HAVE_STARTED'
    && TERMINAL_FIRST_VIDEO_PROVIDER_FAILURE_CODES.includes(attempt?.error?.code);
}

function isKnownRecoverableLockedStageAttempt(attempt, stage) {
  return isKnownPreRequestValidationFailure(attempt, stage)
    || isKnownTerminalFirstVideoProviderFailure(attempt, stage);
}

function isSafeLocalLockedStageRetry(attempt, stage) {
  const deterministicLocalFailure = attempt?.status === 'FAILED'
    && attempt?.boundary_state === 'NOT_CROSSED'
    && ((stage === 'KEYFRAME' && SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES.includes(attempt?.error?.code))
      || (stage === 'FIRST_VIDEO' && SAFE_LOCAL_FIRST_VIDEO_RETRY_CODES.includes(attempt?.error?.code)));
  return deterministicLocalFailure || isKnownRecoverableLockedStageAttempt(attempt, stage);
}

function jsonHasValues(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

async function resetKnownPreProviderFirstVideoExecution(client, {
  workflowId, workspaceId, brandId, attempt,
}) {
  if (!isKnownPreRequestFirstVideoFailure(attempt, 'FIRST_VIDEO')) return null;
  const workflowResult = await client.query(`SELECT production_id,opening_asset_id
    FROM v2_10.locked_keyframe_workflows
    WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`,
  [workflowId, workspaceId, brandId]);
  const workflow = workflowResult.rows[0];
  if (!workflow) throw lockedStageConflict('Locked FIRST_VIDEO recovery cannot resolve the exact workflow');

  let mediaRows = [];
  try {
    mediaRows = (await client.query(`SELECT id,asset_id,status,provider_request_id,provider_status,
        artifact_id,artifact_version,artifact_storage_key,artifact_content_hash,error
      FROM v2_5.media_executions WHERE production_id=$1 ORDER BY created_at,id`,
    [workflow.production_id])).rows;
  } catch (error) {
    if (!['42P01','3F000'].includes(error.code)) throw error;
  }

  const unsafeMedia = mediaRows.find((row) => row.asset_id !== workflow.opening_asset_id
    || row.provider_request_id
    || row.provider_status
    || row.artifact_id
    || row.artifact_version
    || row.artifact_storage_key
    || row.artifact_content_hash
    || row.status === 'SUCCEEDED'
    || row.error?.message !== LEGACY_PRE_REQUEST_FIRST_VIDEO_ERROR.message);
  if (unsafeMedia) throw lockedStageConflict(
    'Historical FIRST_VIDEO attempt has durable provider execution evidence; automatic retry remains blocked');

  const productionResult = await client.query(`SELECT id,status FROM v2_1.productions
    WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`,
  [workflow.production_id, workspaceId, brandId]);
  const production = productionResult.rows[0] || null;
  let jobs = [];
  if (production) {
    if (production.status !== 'DRAFT') throw lockedStageConflict(
      'Historical FIRST_VIDEO production advanced beyond DRAFT; automatic retry remains blocked');
    jobs = (await client.query(`SELECT id,status,payload,result FROM v2_1.jobs
      WHERE production_id=$1 ORDER BY created_at,id`, [workflow.production_id])).rows;
    const unsafeJob = jobs.find((job) => job.status !== 'QUEUED'
      || jsonHasValues(job.result)
      || job.payload?.providerRequestId
      || job.payload?.provider_request_id
      || ['MAY_HAVE_STARTED','COMPLETED'].includes(job.payload?.providerRequestState));
    if (unsafeJob) throw lockedStageConflict(
      'Historical FIRST_VIDEO job has provider execution evidence; automatic retry remains blocked');
    await client.query(`DELETE FROM v2_1.productions
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`,
    [workflow.production_id, workspaceId, brandId]);
  }

  return Object.freeze({
    recoveredAttemptId: attempt.id,
    productionId: workflow.production_id,
    openingAssetId: workflow.opening_asset_id,
    transientProductionReset: Boolean(production),
    transientMediaRowsReset: mediaRows.length,
    transientJobsReset: jobs.length,
  });
}


async function archiveAndResetTerminalFirstVideoExecution(client, {
  workflowId, workspaceId, brandId, attempt,
}) {
  if (!isKnownTerminalFirstVideoProviderFailure(attempt, 'FIRST_VIDEO')) return null;
  const workflowResult = await client.query(`SELECT production_id,opening_asset_id
    FROM v2_10.locked_keyframe_workflows
    WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`,
  [workflowId, workspaceId, brandId]);
  const workflow = workflowResult.rows[0];
  if (!workflow) throw lockedStageConflict('Locked FIRST_VIDEO terminal recovery cannot resolve the exact workflow');

  const mediaRows = (await client.query(`SELECT * FROM v2_5.media_executions
    WHERE production_id=$1 ORDER BY created_at,id`, [workflow.production_id])).rows;
  if (mediaRows.length !== 1) throw lockedStageConflict(
    'Terminal FIRST_VIDEO recovery requires exactly one durable media execution');

  const media = mediaRows[0];
  const exactTerminalFailure = media.asset_id === workflow.opening_asset_id
    && media.status === 'FAILED'
    && Boolean(media.provider_request_id)
    && (!attempt.provider_request_id || media.provider_request_id === attempt.provider_request_id)
    && TERMINAL_FIRST_VIDEO_PROVIDER_FAILURE_CODES.includes(media.error?.code)
    && media.error?.code === attempt.error?.code
    && !media.artifact_id
    && !media.artifact_version
    && !media.artifact_storage_key
    && !media.artifact_content_hash;
  if (!exactTerminalFailure) throw lockedStageConflict(
    'Provider execution is not a proven terminal failure without an artifact; automatic retry remains blocked');

  const productionResult = await client.query(`SELECT id,status FROM v2_1.productions
    WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`,
  [workflow.production_id, workspaceId, brandId]);
  const production = productionResult.rows[0] || null;
  if (!production || production.status !== 'DRAFT') throw lockedStageConflict(
    'Terminal FIRST_VIDEO production advanced beyond DRAFT; automatic retry remains blocked');

  const jobs = (await client.query(`SELECT id,status,payload,result FROM v2_1.jobs
    WHERE production_id=$1 ORDER BY created_at,id`, [workflow.production_id])).rows;
  const unsafeJob = jobs.find((job) => job.status !== 'QUEUED'
    || jsonHasValues(job.result)
    || job.payload?.providerRequestId
    || job.payload?.provider_request_id
    || ['MAY_HAVE_STARTED','COMPLETED'].includes(job.payload?.providerRequestState));
  if (unsafeJob) throw lockedStageConflict(
    'Terminal FIRST_VIDEO job has incompatible execution state; automatic retry remains blocked');

  await client.query(`INSERT INTO v2_10.locked_stage_provider_execution_evidence
    (attempt_id,workflow_id,workspace_id,brand_id,stage,provider_request_id,media_execution_id,snapshot)
    VALUES($1,$2,$3,$4,'FIRST_VIDEO',$5,$6,$7::jsonb)
    ON CONFLICT(attempt_id,media_execution_id) DO NOTHING`,
  [attempt.id, workflowId, workspaceId, brandId, media.provider_request_id, media.id, JSON.stringify(media)]);

  await client.query(`DELETE FROM v2_1.productions
    WHERE id=$1 AND workspace_id=$2 AND brand_id=$3`,
  [workflow.production_id, workspaceId, brandId]);

  return Object.freeze({
    recoveredAttemptId: attempt.id,
    productionId: workflow.production_id,
    openingAssetId: workflow.opening_asset_id,
    terminalProviderFailure: true,
    providerRequestId: media.provider_request_id,
    archivedMediaExecutionId: media.id,
    transientProductionReset: true,
    transientMediaRowsReset: 1,
    transientJobsReset: jobs.length,
  });
}

class HardenedQualityScriptFirstPostgresRepository extends QualityScriptFirstPostgresRepository {
  async recordQualityApproval(args) {
    if (args.decision === 'APPROVED') {
      const existing = await this.db.query(`SELECT * FROM v2_10.quality_stage_approval_events
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
          AND subject_fingerprint=$5 AND decision='APPROVED'
        ORDER BY decided_at DESC,id DESC LIMIT 1`,
      [args.draftId, args.workspaceId, args.brandId, args.stage, args.subjectFingerprint]);
      if (existing.rows[0]) return existing.rows[0];
    }
    return super.recordQualityApproval(args);
  }

  async claimLockedStage({ workflowId, workspaceId, brandId, stage, preflightId }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    const ownsTransaction = client !== this.db;
    try {
      if (ownsTransaction) {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`locked-stage:${workflowId}:${stage}`]);
      }

      const active = await client.query(`SELECT * FROM v2_10.locked_stage_attempts
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
          AND status IN ('RUNNING','NEEDS_RECONCILIATION')
        ORDER BY started_at DESC,id DESC`,
      [workflowId, workspaceId, brandId, stage]);
      const blockingActive = active.rows.find((row) => !isKnownRecoverableLockedStageAttempt(row, stage));
      if (blockingActive) throw lockedStageConflict();
      const recoverableTerminalFirstVideo = active.rows.find((row) => isKnownTerminalFirstVideoProviderFailure(row, stage)) || null;
      const recoverableFirstVideo = active.rows.find((row) => isKnownPreRequestFirstVideoFailure(row, stage)) || null;

      const latest = await client.query(`SELECT * FROM v2_10.locked_stage_attempts
        WHERE workflow_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4 AND preflight_id=$5
        ORDER BY started_at DESC,id DESC LIMIT 1`,
      [workflowId, workspaceId, brandId, stage, preflightId]);
      const prior = latest.rows[0] || null;

      if (prior?.status === 'SUCCEEDED') {
        if (ownsTransaction) await client.query('COMMIT');
        return Object.freeze({ ...prior, reused: true });
      }

      const safeLocalRetry = isSafeLocalLockedStageRetry(prior, stage);
      if (prior && !safeLocalRetry) throw lockedStageConflict();

      const recoveryCleanup = recoverableTerminalFirstVideo
        ? await archiveAndResetTerminalFirstVideoExecution(client, {
          workflowId, workspaceId, brandId, attempt: recoverableTerminalFirstVideo,
        })
        : recoverableFirstVideo
          ? await resetKnownPreProviderFirstVideoExecution(client, {
            workflowId, workspaceId, brandId, attempt: recoverableFirstVideo,
          })
          : null;

      const inserted = await client.query(`INSERT INTO v2_10.locked_stage_attempts
        (workflow_id,workspace_id,brand_id,stage,preflight_id,status,boundary_state)
        VALUES($1,$2,$3,$4,$5,'RUNNING','NOT_CROSSED') RETURNING *`,
      [workflowId, workspaceId, brandId, stage, preflightId]);
      if (!inserted.rows[0]) throw lockedStageConflict('Locked-stage attempt could not be claimed');

      if (ownsTransaction) await client.query('COMMIT');
      return Object.freeze({
        ...inserted.rows[0],
        reused: false,
        safeLocalRetry,
        retryOfAttemptId: safeLocalRetry ? prior.id : null,
        recoveredPreProviderAttemptId: recoverableFirstVideo?.id || null,
        recoveredTerminalProviderAttemptId: recoverableTerminalFirstVideo?.id || null,
        recoveryCleanup,
      });
    } catch (error) {
      if (ownsTransaction) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  async getLockedWorkflow({ draftId, workspaceId, brandId, shotId = null, canonicalIntentFingerprint = null }) {
    try {
      const result = await this.db.query(`SELECT * FROM v2_10.locked_keyframe_workflows
        WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3
          AND ($4::text IS NULL OR opening_shot_id=$4)
          AND ($5::text IS NULL OR canonical_intent_fingerprint=$5)
        ORDER BY created_at DESC,id DESC LIMIT 1`,
      [draftId, workspaceId, brandId, shotId, canonicalIntentFingerprint]);
      return result.rows[0] || null;
    } catch (error) {
      if (['42P01','3F000'].includes(error.code)) return null;
      throw error;
    }
  }
}

module.exports = {
  HardenedQualityScriptFirstPostgresRepository,
  LEGACY_PRE_REQUEST_SEMANTIC_TIER_ERROR,
  LEGACY_PRE_REQUEST_FIRST_VIDEO_ERROR,
  SAFE_LOCAL_LOCKED_STAGE_RETRY_CODES,
  SAFE_LOCAL_FIRST_VIDEO_RETRY_CODES,
  TERMINAL_FIRST_VIDEO_PROVIDER_FAILURE_CODES,
  isKnownPreRequestSemanticTierFailure,
  isKnownPreRequestFirstVideoFailure,
  isKnownPreRequestValidationFailure,
  isKnownTerminalFirstVideoProviderFailure,
  isKnownRecoverableLockedStageAttempt,
  isSafeLocalLockedStageRetry,
  resetKnownPreProviderFirstVideoExecution,
  archiveAndResetTerminalFirstVideoExecution,
};