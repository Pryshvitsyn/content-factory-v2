'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBibleRequest, fingerprint, validateProviderBible } = require('../worker/v2.1-bible-generation');

const production = {
  id: 'p1',
  context_fingerprint: 'ctx_immutable',
  request_snapshot: { objective: 'conversion' },
};
const context = {
  tenant: { id: 't1', version: 1 },
  business: { id: 'b1', version: 2 },
  brand: { id: 'br1', version: 3 },
  strategy: { id: 's1', version: 4 },
};
const script = {
  id: 'script-1',
  version: 2,
  outputHash: 'script-hash',
  value: { title: 'The Choice', scenes: [{ sceneNumber: 1 }] },
};

function providerOutput() {
  return {
    creativeTruth: {
      concept: 'A human moment of recognition.',
      narrative: { arc: ['setup', 'recognition', 'choice'] },
      brandRules: { forbiddenClaims: ['unsupported claims'] },
      style: { visual: 'naturalistic' },
      characters: [{ id: 'person-1', version: 1, invariants: ['same face'] }],
      locations: [{ id: 'loc-1', version: 1 }],
      styles: [{ id: 'style-1', version: 1 }],
    },
    productionPlan: {
      objective: { cta: 'learn' },
      shots: [{ number: 1, description: 'Opening', action: 'Look up', assetRefs: [] }],
      assetRequirements: [],
      editions: [{ platform: 'TIKTOK', constraints: { aspectRatio: '9:16' } }],
    },
  };
}

test('BIBLE request fingerprint is stable across object key order', () => {
  const a = buildBibleRequest({ production, context, script, signal: { topic: 'x', urgency: true } });
  const b = buildBibleRequest({
    production: { request_snapshot: { objective: 'conversion' }, context_fingerprint: 'ctx_immutable', id: 'p1' },
    context: { strategy: context.strategy, brand: context.brand, business: context.business, tenant: context.tenant },
    script: { value: script.value, outputHash: 'script-hash', version: 2, id: 'script-1' },
    signal: { urgency: true, topic: 'x' },
  });
  assert.equal(fingerprint(a), fingerprint(b));
});

test('BIBLE request carries immutable context and exact SCRIPT provenance', () => {
  const request = buildBibleRequest({ production, context, script, signal: {} });
  assert.equal(request.production.contextFingerprint, 'ctx_immutable');
  assert.equal(request.source.scriptArtifactId, 'script-1');
  assert.equal(request.source.scriptArtifactVersion, 2);
  assert.equal(request.source.scriptOutputHash, 'script-hash');
});

test('provider output cannot replace factory context or provider boundary', () => {
  assert.throws(() => validateProviderBible({ ...providerOutput(), context }), /must not contain context/);
  assert.throws(() => validateProviderBible({ ...providerOutput(), provider: 'nvidia' }), /must not contain provider/);
  assert.throws(() => validateProviderBible({ ...providerOutput(), model: 'model' }), /must not contain model/);
});

test('provider output validator rejects malformed BIBLE shape', () => {
  assert.throws(() => validateProviderBible({ creativeTruth: {} }), /productionPlan/);
  assert.throws(() => validateProviderBible({ productionPlan: {} }), /creativeTruth/);
});

test('provider output validator accepts canonical provider shape', () => {
  assert.equal(validateProviderBible(providerOutput()), true);
});
