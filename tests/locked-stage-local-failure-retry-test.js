'use strict';

const assert = require('node:assert/strict');
const { HardenedQualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-repository');

function dbFor({ latest = null, active = null, insertedId = 'attempt-new',
  workflow = { production_id: 'production-1', opening_asset_id: 'video-1' },
  mediaRows = [], production = null, jobs = [] } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [{ ok: true }] };
      if (text.includes("status IN ('RUNNING','NEEDS_RECONCILIATION')")) {
        return { rows: active ? (Array.isArray(active) ? active : [active]) : [] };
      }
      if (text.includes('preflight_id=$5') && text.includes('ORDER BY started_at')) return { rows: latest ? [latest] : [] };
      if (text.includes('SELECT production_id,opening_asset_id') && text.includes('locked_keyframe_workflows')) {
        return { rows: workflow ? [workflow] : [] };
      }
      if (text.includes('FROM v2_5.media_executions WHERE production_id=$1')) return { rows: mediaRows };
      if (text.includes('SELECT id,status FROM v2_1.productions')) return { rows: production ? [production] : [] };
      if (text.includes('SELECT id,status,payload,result FROM v2_1.jobs')) return { rows: jobs };
      if (text.includes('INSERT INTO v2_10.locked_stage_provider_execution_evidence')) return { rows: [], rowCount: 1 };
      if (text.includes('DELETE FROM v2_1.productions')) return { rows: [], rowCount: production ? 1 : 0 };
      if (text.includes('INSERT INTO v2_10.locked_stage_attempts')) return { rows: [{
        id: insertedId, workflow_id: params[0], workspace_id: params[1], brand_id: params[2],
        stage: params[3], preflight_id: params[4], status: 'RUNNING', boundary_state: 'NOT_CROSSED',
      }] };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return {
    calls,
    async connect() { return client; },
  };
}

const args = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  brandId: 'brand-1',
  stage: 'KEYFRAME',
  preflightId: 'preflight-1',
};

async function main() {
  {
    const db = dbFor({ latest: {
      id: 'attempt-old', status: 'FAILED', boundary_state: 'NOT_CROSSED',
      error: { code: 'KEYFRAME_GEOMETRY_MISMATCH' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage(args);
    assert.equal(result.id, 'attempt-new');
    assert.equal(result.status, 'RUNNING');
    assert.equal(result.safeLocalRetry, true);
    assert.equal(result.retryOfAttemptId, 'attempt-old');
    assert.equal(db.calls.some((call) => call.sql.includes('UPDATE v2_10.locked_stage_attempts')), false,
      'terminal attempt evidence must never be rewritten for retry');
    assert.equal(db.calls.filter((call) => call.sql.includes('INSERT INTO v2_10.locked_stage_attempts')).length, 1);
  }

  {
    const db = dbFor({ latest: {
      id: 'attempt-unsafe', status: 'FAILED', boundary_state: 'NOT_CROSSED',
      error: { code: 'SEMANTIC_VISUAL_PROVIDER_ERROR' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage(args),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  {
    const db = dbFor({ active: {
      id: 'attempt-ambiguous', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: null, error: { code: 'SYNTHETIC_NETWORK_UNKNOWN' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage(args),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  {
    const db = dbFor({ active: {
      id: 'attempt-known-local-tier', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: null,
      error: { code: 'KEYFRAME_STAGE_FAILED', message: 'Unsupported quality tier QUALITY' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage({ ...args, preflightId: 'fresh-preflight' });
    assert.equal(result.id, 'attempt-new');
    assert.equal(result.reused, false);
    assert.equal(result.safeLocalRetry, false,
      'fresh preflight recovery ignores the historical active fence but is not a same-preflight retry');
    assert.equal(db.calls.filter((call) => call.sql.includes('INSERT INTO v2_10.locked_stage_attempts')).length, 1);
  }

  {
    const db = dbFor({ active: {
      id: 'attempt-tier-with-provider-id', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: 'provider-request-1',
      error: { code: 'KEYFRAME_STAGE_FAILED', message: 'Unsupported quality tier QUALITY' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage({ ...args, preflightId: 'fresh-preflight' }),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED',
      'provider request evidence must keep the attempt fenced');
  }

  {
    const old = {
      id: 'attempt-first-video-old', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: null,
      error: { code: 'FIRST_VIDEO_STAGE_FAILED', message: 'Seedance 2.5 duration must be 1-30 seconds' },
    };
    const db = dbFor({
      active: old,
      mediaRows: [{
        id: 'media-old', asset_id: 'video-1', status: 'NEEDS_RECONCILIATION',
        provider_request_id: null, provider_status: null, artifact_id: null, artifact_version: null,
        artifact_storage_key: null, artifact_content_hash: null,
        error: { code: 'MEDIA_EXECUTION_FAILED', message: 'Seedance 2.5 duration must be 1-30 seconds' },
      }],
      production: { id: 'production-1', status: 'DRAFT' },
      jobs: [{ id: 'job-1', status: 'QUEUED', payload: { providerRequestState: 'NOT_STARTED' }, result: {} }],
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'corrected-first-video-preflight',
    });
    assert.equal(result.id, 'attempt-new');
    assert.equal(result.recoveredPreProviderAttemptId, old.id);
    assert.equal(result.recoveryCleanup.transientProductionReset, true);
    assert.equal(result.recoveryCleanup.transientMediaRowsReset, 1);
    assert.equal(db.calls.filter((call) => call.sql.includes('DELETE FROM v2_1.productions')).length, 1);
    assert.equal(db.calls.some((call) => call.sql.includes('UPDATE v2_10.locked_stage_attempts')), false,
      'historical locked-stage evidence remains immutable');
    assert.equal(db.calls.filter((call) => call.sql.includes('INSERT INTO v2_10.locked_stage_attempts')).length, 1,
      'recovery appends a new FIRST_VIDEO attempt');
  }

  {
    const db = dbFor({ active: {
      id: 'attempt-first-video-provider-id', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: 'replicate-prediction-1',
      error: { code: 'FIRST_VIDEO_STAGE_FAILED', message: 'Seedance 2.5 duration must be 1-30 seconds' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'corrected-first-video-preflight',
    }), (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  {
    const db = dbFor({ active: {
      id: 'attempt-first-video-unknown', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: null,
      error: { code: 'FIRST_VIDEO_STAGE_FAILED', message: 'synthetic network uncertainty' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'corrected-first-video-preflight',
    }), (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  {
    const old = {
      id: 'attempt-first-video-with-media-evidence', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: null,
      error: { code: 'FIRST_VIDEO_STAGE_FAILED', message: 'Seedance 2.5 duration must be 1-30 seconds' },
    };
    const db = dbFor({
      active: old,
      mediaRows: [{
        id: 'media-old', asset_id: 'video-1', status: 'NEEDS_RECONCILIATION',
        provider_request_id: 'replicate-prediction-2', provider_status: 'processing',
        artifact_id: null, artifact_version: null, artifact_storage_key: null, artifact_content_hash: null,
        error: { code: 'MEDIA_EXECUTION_FAILED', message: 'Seedance 2.5 duration must be 1-30 seconds' },
      }],
      production: { id: 'production-1', status: 'DRAFT' },
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'corrected-first-video-preflight',
    }), (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
    assert.equal(db.calls.some((call) => call.sql.includes('DELETE FROM v2_1.productions')), false,
      'provider evidence must prevent transient production cleanup');
  }

  {
    const terminal = {
      id: 'attempt-first-video-terminal', status: 'NEEDS_RECONCILIATION', boundary_state: 'MAY_HAVE_STARTED',
      provider_request_id: 'replicate-terminal-1',
      error: { code: 'REPLICATE_PREDICTION_FAILED',
        message: 'Replicate prediction failed: Duration must be between 4 and 30 seconds' },
    };
    const db = dbFor({
      active: terminal,
      mediaRows: [{
        id: 'media-terminal-1', asset_id: 'video-1', status: 'FAILED',
        provider_request_id: 'replicate-terminal-1', provider_status: 'starting',
        artifact_id: null, artifact_version: null, artifact_storage_key: null, artifact_content_hash: null,
        error: { code: 'REPLICATE_PREDICTION_FAILED',
          message: 'Replicate prediction failed: Duration must be between 4 and 30 seconds' },
      }],
      production: { id: 'production-1', status: 'DRAFT' },
      jobs: [{ id: 'job-1', status: 'QUEUED', payload: { providerRequestState: 'NOT_STARTED' }, result: {} }],
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'corrected-four-second-preflight',
    });
    assert.equal(result.id, 'attempt-new');
    assert.equal(result.recoveredTerminalProviderAttemptId, terminal.id);
    assert.equal(result.recoveryCleanup.terminalProviderFailure, true);
    assert.equal(result.recoveryCleanup.providerRequestId, terminal.provider_request_id);
    assert.equal(db.calls.filter((call) => call.sql.includes('INSERT INTO v2_10.locked_stage_provider_execution_evidence')).length, 1,
      'terminal provider failure must be archived before transient execution rows are reset');
    assert.equal(db.calls.filter((call) => call.sql.includes('DELETE FROM v2_1.productions')).length, 1);
    assert.equal(db.calls.some((call) => call.sql.includes('UPDATE v2_10.locked_stage_attempts')), false,
      'terminal locked-stage evidence remains immutable');
  }

  {
    const db = dbFor({ latest: {
      id: 'attempt-first-video-disabled', status: 'FAILED', boundary_state: 'NOT_CROSSED',
      provider_request_id: null,
      error: { code: 'V210_EXECUTION_DISABLED',
        message: 'LIVE_PAID_GENERATION=true is required after reviewing the first-video preflight' },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage({
      ...args, stage: 'FIRST_VIDEO', preflightId: 'preflight-1',
    });
    assert.equal(result.id, 'attempt-new');
    assert.equal(result.safeLocalRetry, true);
    assert.equal(result.retryOfAttemptId, 'attempt-first-video-disabled');
    assert.equal(db.calls.some((call) => call.sql.includes('UPDATE v2_10.locked_stage_attempts')), false);
  }

  {
    const db = dbFor({ latest: {
      id: 'attempt-success', status: 'SUCCEEDED', boundary_state: 'COMPLETED', result: { ok: true },
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const reused = await repository.claimLockedStage(args);
    assert.equal(reused.id, 'attempt-success');
    assert.equal(reused.reused, true);
    assert.equal(db.calls.some((call) => call.sql.includes('INSERT INTO v2_10.locked_stage_attempts')), false);
  }

  console.log('Locked-stage append-only retry, pre-provider recovery, terminal provider evidence archival, and ambiguous fencing passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});