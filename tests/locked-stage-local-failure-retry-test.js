'use strict';

const assert = require('node:assert/strict');
const { HardenedQualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-repository');

function dbFor(existing) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO v2_10.locked_stage_attempts')) return { rows: [] };
      if (String(sql).includes('SELECT * FROM v2_10.locked_stage_attempts')) return { rows: [existing] };
      if (String(sql).includes('UPDATE v2_10.locked_stage_attempts')) {
        const safeCodes = params[5];
        const eligible = existing.status === 'FAILED'
          && existing.boundary_state === 'NOT_CROSSED'
          && safeCodes.includes(existing.error?.code);
        return { rows: eligible ? [{ ...existing, status: 'RUNNING', boundary_state: 'NOT_CROSSED' }] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
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
    const db = dbFor({
      id: 'attempt-1', status: 'FAILED', boundary_state: 'NOT_CROSSED',
      error: { code: 'KEYFRAME_GEOMETRY_MISMATCH' },
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const result = await repository.claimLockedStage(args);
    assert.equal(result.status, 'RUNNING');
    assert.equal(result.safeLocalRetry, true);
    assert.equal(db.calls.filter((call) => call.sql.includes('UPDATE v2_10.locked_stage_attempts')).length, 1);
  }

  {
    const db = dbFor({
      id: 'attempt-2', status: 'FAILED', boundary_state: 'NOT_CROSSED',
      error: { code: 'SEMANTIC_VISUAL_PROVIDER_ERROR' },
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage(args),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  {
    const db = dbFor({
      id: 'attempt-3', status: 'FAILED', boundary_state: 'MAY_HAVE_STARTED',
      error: { code: 'KEYFRAME_GEOMETRY_MISMATCH' },
    });
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    await assert.rejects(() => repository.claimLockedStage(args),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
  }

  console.log('Locked-stage safe local retry contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
