'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, stableStringify, stageContract, allStageNames } = require('../worker/v2.1-execution-engine');

const EXPECTED = [
  'SIGNAL','IDEA','BRIEF','CONCEPT','SCRIPT','BIBLE','SHOT_PLAN','ASSET_PLAN',
  'ASSET_GENERATION','CONTINUITY','EDIT','PLATFORM_ADAPTATION','VALIDATION','PUBLISH','ANALYZE','LEARN',
];

test('execution engine exposes the complete ordered production graph', () => {
  assert.deepEqual(allStageNames(), EXPECTED);
});

test('stage contracts declare dependencies and outputs', () => {
  for (const stage of EXPECTED) {
    const contract = stageContract(stage);
    assert.ok(Array.isArray(contract.requires));
    assert.ok(Array.isArray(contract.outputs));
    assert.ok(contract.outputs.length > 0);
  }
  assert.deepEqual(stageContract('IDEA').requires, ['SIGNAL_SET']);
  assert.deepEqual(stageContract('SHOT_PLAN').requires, ['PRODUCTION_BIBLE', 'SCRIPT']);
  assert.deepEqual(stageContract('ASSET_PLAN').requires, ['PRODUCTION_BIBLE', 'SHOTS']);
  assert.deepEqual(stageContract('PUBLISH').requires, ['VALIDATION_REPORT', 'EDITIONS']);
});

test('parallel groups remain explicit instead of being hidden in the worker', () => {
  assert.equal(stageContract('ASSET_GENERATION').parallelGroup, 'GENERATION');
  assert.equal(stageContract('PLATFORM_ADAPTATION').parallelGroup, 'PLATFORM');
  assert.equal(stageContract('PUBLISH').parallelGroup, 'PLATFORM');
  assert.equal(stageContract('SHOT_PLAN').parallelGroup, null);
});

test('stable fingerprints ignore object key order', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(fingerprint({ request: { b: 2, a: 1 } }), fingerprint({ request: { a: 1, b: 2 } }));
});

test('stage fingerprints change when execution inputs change', () => {
  assert.notEqual(fingerprint({ stage: 'SCRIPT', input: { concept: 'A' } }), fingerprint({ stage: 'SCRIPT', input: { concept: 'B' } }));
});
