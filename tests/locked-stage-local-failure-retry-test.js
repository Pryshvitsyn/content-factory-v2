'use strict';

const assert = require('node:assert/strict');
const { HardenedQualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-repository');

function dbFor({ latest = null, active = null, insertedId = 'attempt-new' } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [{ ok: true }] };
      if (text.includes("status IN ('RUNNING','NEEDS_RECONCILIATION')")) return { rows: active ? [active] : [] };
      if (text.includes('preflight_id=$5') && text.includes('ORDER BY started_at')) return { rows: latest ? [latest] : [] };
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
    } });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage(args),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
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

  console.log('Locked-stage append-only safe local retry contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
