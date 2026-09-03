'use strict';

const assert = require('node:assert/strict');
const { LockedKeyframeStateService } = require('../src/v2.10/locked-keyframe-state-service');

async function main() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM v2_10.locked_keyframe_workflows')) return { rows: [{
        id: 'workflow-1', state: 'KEYFRAME_READY', production_id: 'production-1',
        opening_shot_id: 'shot-1', opening_asset_id: 'video-1',
      }] };
      if (sql.includes('FROM v2_10.locked_stage_attempts')) return { rows: [{
        id: 'attempt-1', status: 'FAILED', boundary_state: 'COMPLETED',
        started_at: '2026-09-03T18:00:00.000Z', completed_at: '2026-09-03T18:00:01.000Z',
        result: {
          keyframe: {
            id: 'keyframe-1', version: 2, contentHash: 'hash-1', sourceType: 'OPERATOR_UPLOAD',
            provider: 'operator-upload', model: 'uploaded-image', width: 720, height: 1280,
            validationStatus: 'FAIL', approvalDecision: null, immutable: true,
          },
          validation: {
            status: 'FAIL',
            checks: [
              { code: 'CREATIVE_PLAN_MISMATCH', status: 'FAIL', reason: 'The visible opening state does not match the approved shot plan.' },
              { code: 'UNEXPECTED_GENERATED_TEXT', status: 'PASS', reason: 'No generated text is visible.' },
            ],
            metadata: { provider: 'openai', model: 'gpt-5.6-luna', externalCalls: 1, secret: 'must-not-leak' },
          },
          lifecycle: 'KEYFRAME_VALIDATION_FAILED', remainingProductionScheduled: false,
          humanApprovalRequired: true, autoPublish: false,
        },
      }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const brandRepository = {
    async getBrand(id) {
      assert.equal(id, 'brand-1');
      return { id, workspaceId: 'workspace-1' };
    },
  };
  const service = new LockedKeyframeStateService({ db, brandRepository });
  const state = await service.state({ draftId: 'draft-1', brandId: 'brand-1' });

  assert.equal(state.externalCalls, 0, 'reading persisted validation must never make an external call');
  assert.equal(state.workflow.id, 'workflow-1');
  assert.equal(state.attempt.status, 'FAILED');
  assert.equal(state.keyframeResult.validation.status, 'FAIL');
  assert.equal(state.keyframeResult.validation.checks.length, 2);
  assert.equal(state.keyframeResult.validation.checks[0].code, 'CREATIVE_PLAN_MISMATCH');
  assert.match(state.keyframeResult.validation.checks[0].reason, /approved shot plan/);
  assert.equal(state.keyframeResult.validation.metadata.provider, 'openai');
  assert.equal(state.keyframeResult.validation.metadata.model, 'gpt-5.6-luna');
  assert.equal(state.keyframeResult.validation.metadata.externalCalls, 1);
  assert.equal(Object.hasOwn(state.keyframeResult.validation.metadata, 'secret'), false,
    'read-only operator state must expose only bounded evaluator metadata');
  assert.equal(calls.length, 2, 'state read should require only workflow and persisted-attempt queries');
  assert(calls.every(({ sql }) => /^SELECT/i.test(sql.trim())), 'state endpoint must be strictly read-only');

  await assert.rejects(() => service.state({ draftId: null, brandId: 'brand-1' }),
    (error) => error.code === 'LOCKED_KEYFRAME_STATE_SCOPE_REQUIRED');

  console.log('Persisted locked-keyframe semantic validation is recoverable read-only with 0 external calls: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
