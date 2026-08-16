'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fingerprint,
  normalizeAssetRequirements,
  normalizeShots,
  buildPlanFingerprint,
} = require('../worker/v2.1-planning-engine');

function sampleBible() {
  return {
    productionPlan: {
      shots: [
        { number: 1, durationMs: 3000, description: 'Setup', action: 'Enter', assetRefs: [{ id: 'char-main', type: 'CHARACTER', version: 1 }] },
        { number: 2, durationMs: 4000, description: 'Choice', action: 'Turn', continuityRequirements: ['same identity'], assetRefs: [{ id: 'char-main', type: 'CHARACTER', version: 1 }] },
      ],
      assetRequirements: [
        { id: 'char-main', role: 'main-character', type: 'CHARACTER', version: 1 },
        { id: 'location-main', role: 'main-location', type: 'LOCATION', version: 2 },
      ],
    },
  };
}

test('planning fingerprint is stable across object key order', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
});

test('SHOT_PLAN preserves deterministic numbering and script provenance fields', () => {
  const shots = normalizeShots({
    bible: sampleBible(),
    script: { scenes: [{ purpose: 'setup', visual: 'room' }, { purpose: 'choice', visual: 'door' }] },
  });
  assert.deepEqual(shots.map((shot) => shot.shotNumber), [1, 2]);
  assert.equal(shots[1].instructions.purpose, 'choice');
  assert.deepEqual(shots[1].instructions.continuityRequirements, ['same identity']);
});

test('SHOT_PLAN rejects non-contiguous numbering', () => {
  assert.throws(() => normalizeShots({ bible: { productionPlan: { shots: [{ number: 1, durationMs: 1000 }, { number: 3, durationMs: 1000 }] } }, script: {} }), /contiguous/);
});

test('ASSET_PLAN expands global declarations into every durable shot requirement', () => {
  const requirements = normalizeAssetRequirements(sampleBible());
  assert.equal(requirements.length, 4);
  assert.deepEqual(requirements.map((row) => `${row.shotNumber}:${row.assetRole}`), [
    '1:main-character', '1:main-location', '2:main-character', '2:main-location',
  ]);
});

test('ASSET_PLAN rejects duplicate role within a shot', () => {
  assert.throws(() => normalizeAssetRequirements({ productionPlan: {
    shots: [{ number: 1, assetRefs: [{ id: 'a', type: 'CHARACTER' }, { id: 'b', type: 'CHARACTER', role: 'a' }] },],
    assetRequirements: [],
  } }), /Duplicate ASSET_PLAN requirement/);
});

test('plan fingerprint changes when BIBLE or source document changes', () => {
  const production = { id: 'p1', context_fingerprint: 'ctx' };
  const bible = { id: 'b1', version: 1, outputHash: 'bh1' };
  const a = buildPlanFingerprint({ production, bible, kind: 'SHOT_PLAN', document: { shots: [1] } });
  const b = buildPlanFingerprint({ production, bible: { ...bible, outputHash: 'bh2' }, kind: 'SHOT_PLAN', document: { shots: [1] } });
  assert.notEqual(a, b);
});
