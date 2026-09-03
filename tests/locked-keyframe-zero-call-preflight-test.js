'use strict';

const assert = require('node:assert/strict');
const creativeBrief = require('../fixtures/v2.10/attune-creative-2-draft.json');
const { QualityLockedKeyframeService } = require('../src/v2.10/quality-locked-keyframe-service');

async function main() {
  const brandId = '6117e20a-cf33-42b2-a9e2-32df9653c3d1';
  const draftId = '10000000-0000-4000-8000-000000000001';
  const draft = { id: draftId, revision: 3, status: 'DRAFT', creative_brief: creativeBrief };
  let savedPlan = null;
  let externalCalls = 0;

  const service = new QualityLockedKeyframeService({
    repository: {
      async getDraft() { return draft; },
      async ensureLockedWorkflow() { return { id: 'workflow-zero-call', production_id: 'production-zero-call' }; },
      async saveLockedStagePreflight({ plan }) { savedPlan = plan; return { id: 'preflight-zero-call' }; },
    },
    brandRepository: { async getBrand() { return { workspaceId: 'workspace-zero-call' }; } },
    providerCatalog: {},
    starter: {},
    storage: {},
    imageInspector: {},
    stillEvaluator: {
      configured: false,
      provider: null,
      model: null,
      async evaluate() { externalCalls += 1; throw new Error('must not execute'); },
    },
    env: {
      SEMANTIC_VISUAL_ENABLED: 'false',
      LIVE_PAID_VISUAL_EVALUATION: 'false',
    },
  });

  const shotId = creativeBrief.storyboard[0].shotId;
  const plan = await service.preflightKeyframe({
    id: draftId,
    brandId,
    shotId,
    keyframe: { sourceType: 'OPERATOR_UPLOAD' },
  });

  assert(savedPlan, 'preflight must persist the zero-call execution plan');
  assert.equal(plan.preflightId, 'preflight-zero-call');
  assert.equal(plan.providerCallsMade, 0);
  assert.equal(plan.semanticEvaluatorConfigured, false);
  assert.equal(plan.executionReadiness, 'BLOCKED_SEMANTIC_EVALUATOR_NOT_CONFIGURED');
  assert.equal(plan.externalCalls.imageGeneration, 0);
  assert.equal(plan.externalCalls.semanticImageEvaluation, 1);
  assert.equal(plan.externalCalls.maximum, 1);
  assert.equal(plan.externalCalls.alreadyMade, 0);
  assert.equal(externalCalls, 0, 'preflight must never call the semantic provider');

  await assert.rejects(() => service.executeKeyframe({
    id: draftId,
    brandId,
    shotId,
    preflightId: plan.preflightId,
    fingerprint: plan.fingerprint,
    confirmation: true,
  }), (error) => error.code === 'SEMANTIC_STILL_EVALUATOR_NOT_CONFIGURED'
    && /no provider calls were made/i.test(error.message));
  assert.equal(externalCalls, 0, 'execution must fail before any provider boundary when semantic QA is not configured');

  console.log('Zero-call keyframe preflight remains available without semantic configuration; execution fails before provider calls.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
