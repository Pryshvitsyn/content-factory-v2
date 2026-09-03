'use strict';

const assert = require('node:assert/strict');
const creativeBrief = require('../fixtures/v2.10/attune-creative-2-draft.json');
const { buildKeyframeStagePlan } = require('../src/v2.10/locked-keyframe-contract');
const { LockedKeyframeService } = require('../src/v2.10/locked-keyframe-service');

async function main() {
  const brandId = '6117e20a-cf33-42b2-a9e2-32df9653c3d1';
  const draftId = '10000000-0000-4000-8000-000000000001';
  const shotId = creativeBrief.storyboard[0].shotId;
  const draft = { id: draftId, revision: 3, status: 'DRAFT', creative_brief: creativeBrief };
  const workflow = { id: 'workflow-boundary', production_id: 'production-boundary', opening_asset_id: creativeBrief.storyboard[0].assetId };
  const plan = buildKeyframeStagePlan({
    draft,
    shotId,
    selection: {
      sourceType: 'OPERATOR_UPLOAD',
      resolvedSettings: { uploadPreflightNonce: '11111111-1111-4111-8111-111111111111' },
    },
    semantic: { provider: 'openai', model: 'synthetic-vision-model' },
  });
  const preflight = {
    id: 'preflight-boundary',
    fingerprint: plan.fingerprint,
    draft_revision: draft.revision,
    execution_plan: plan,
  };

  const order = [];
  let finish = null;
  const repository = {
    async getDraft() { return draft; },
    async getLockedWorkflow() { return workflow; },
    async getLockedStagePreflight() { return preflight; },
    async claimLockedStage() { order.push('claim'); return { id: 'attempt-boundary', reused: false }; },
    async markLockedStageBoundary() { order.push('boundary'); return { id: 'attempt-boundary', boundary_state: 'MAY_HAVE_STARTED' }; },
    async storeKeyframeArtifact(value) {
      order.push('store');
      return {
        id: 'keyframe-artifact',
        workflow_id: workflow.id,
        production_id: workflow.production_id,
        brand_id: brandId,
        shot_id: shotId,
        asset_id: value.assetId,
        version: 1,
        source_type: value.sourceType,
        provider: value.provider,
        model: value.model,
        generation_settings: value.generationSettings,
        prompt_fingerprint: value.promptFingerprint,
        storage_key: 'immutable/keyframe-artifact',
        content_hash: value.contentHash,
        content_type: value.contentType,
        width: value.width,
        height: value.height,
        provider_request_id: null,
      };
    },
    async finishLockedStage(value) { finish = value; order.push('finish'); return value; },
  };

  const service = new LockedKeyframeService({
    repository,
    brandRepository: { async getBrand() { return { workspaceId: 'workspace-boundary' }; } },
    providerCatalog: {},
    starter: {},
    storage: {},
    imageInspector: {
      async inspect() {
        order.push('inspect');
        // Real FfprobeMediaInspector contract supplies decoded dimensions. The service
        // must derive canonical aspect geometry itself rather than requiring a synthetic
        // precomputed aspectRatio property from callers.
        return { width: 720, height: 1280 };
      },
    },
    stillEvaluator: {
      configured: true,
      async evaluate() {
        order.push('semantic');
        const error = new Error('synthetic semantic transport uncertainty');
        error.code = 'SEMANTIC_VISUAL_PROVIDER_ERROR';
        throw error;
      },
    },
    env: { SEMANTIC_VISUAL_PROVIDER: 'openai', SEMANTIC_VISUAL_MODEL: 'synthetic-vision-model' },
  });

  await assert.rejects(() => service.executeKeyframe({
    id: draftId,
    brandId,
    shotId,
    preflightId: preflight.id,
    fingerprint: plan.fingerprint,
    confirmation: true,
    contentBase64: Buffer.from('synthetic-image-bytes').toString('base64'),
    contentType: 'image/png',
  }), (error) => error.code === 'SEMANTIC_VISUAL_PROVIDER_ERROR');

  assert(order.indexOf('boundary') > order.indexOf('inspect'), 'local image inspection must finish before external boundary');
  assert(order.indexOf('boundary') < order.indexOf('semantic'), 'semantic provider boundary must be recorded before evaluator invocation');
  assert.equal(order.filter((value) => value === 'boundary').length, 1);
  assert(finish, 'ambiguous semantic failure must durably finish the attempt');
  assert.equal(finish.status, 'NEEDS_RECONCILIATION');
  assert.equal(finish.boundaryState, 'MAY_HAVE_STARTED');
  assert.equal(finish.error.code, 'SEMANTIC_VISUAL_PROVIDER_ERROR');

  console.log('Canonical 720x1280 keyframe dimensions pass geometry validation; semantic boundary is fenced before provider invocation.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
