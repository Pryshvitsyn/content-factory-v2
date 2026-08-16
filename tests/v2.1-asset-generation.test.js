'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAssetGenerationRequest,
  fingerprint,
  validateAssetGeneration,
} = require('../worker/v2.1-asset-generation');

const production = {
  id: 'production-1',
  context_fingerprint: 'ctx-1',
  request_snapshot: { topic: 'human moments' },
  context_snapshot: { brand: { tone: 'restrained' } },
};

const requirements = [
  {
    id: 'req-1',
    shot_id: 'shot-1',
    asset_role: 'hero',
    required_asset_type: 'CHARACTER',
    required_asset_id: null,
    constraints: { appearance: 'consistent' },
    plan_fingerprint: 'plan-1',
  },
];

const validOutput = {
  assets: [
    {
      requirementId: 'req-1',
      assetType: 'CHARACTER',
      name: 'Hero',
      canonicalData: { role: 'main character', invariants: ['identity'] },
      versionData: { appearance: 'naturalistic' },
    },
  ],
};

test('ASSET_GENERATION request fingerprint is stable across object key order', () => {
  const a = buildAssetGenerationRequest({ production, requirements });
  const b = buildAssetGenerationRequest({
    production: { ...production, context_snapshot: { brand: { tone: 'restrained' } } },
    requirements: [{ ...requirements[0], constraints: { appearance: 'consistent' } }],
  });
  assert.equal(fingerprint(a), fingerprint(b));
});

test('ASSET_GENERATION request carries immutable production context and exact requirement provenance', () => {
  const request = buildAssetGenerationRequest({ production, requirements });
  assert.equal(request.production.contextFingerprint, 'ctx-1');
  assert.equal(request.sources.assetPlan[0].requirementId, 'req-1');
  assert.equal(request.sources.assetPlan[0].planFingerprint, 'plan-1');
  assert.equal(request.outputContract.type, 'ASSETS');
});

test('ASSET_GENERATION validator rejects malformed provider output', () => {
  assert.throws(() => validateAssetGeneration({ assets: [] }, requirements), /exactly 1 generated assets/);
  assert.throws(() => validateAssetGeneration({ assets: [{ ...validOutput.assets[0], assetType: 'VOICE' }] }, requirements), /type does not match/);
  assert.throws(() => validateAssetGeneration({ assets: [{ ...validOutput.assets[0], canonicalData: null }] }, requirements), /missing canonicalData/);
});

test('ASSET_GENERATION validator rejects duplicate requirement output', () => {
  const duplicate = { assets: [validOutput.assets[0], validOutput.assets[0]] };
  assert.throws(() => validateAssetGeneration(duplicate, requirements), /generated more than once/);
});

test('ASSET_GENERATION validator accepts canonical output shape', () => {
  assert.equal(validateAssetGeneration(validOutput, requirements), true);
});
