'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FIRST_VERTICAL_SLICE, EDIT_VERTICAL_SLICE, HANDLERS, normalizeSignal } = require('../worker/v2.1-production-orchestrator');

test('vertical slice is explicit and ordered through durable planning', () => {
  assert.deepEqual(FIRST_VERTICAL_SLICE, ['SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT', 'BIBLE', 'SHOT_PLAN', 'ASSET_PLAN']);
});

test('EDIT vertical slice is explicit and ordered after CONTINUITY', () => {
  assert.deepEqual(EDIT_VERTICAL_SLICE, ['SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT', 'BIBLE', 'SHOT_PLAN', 'ASSET_PLAN', 'ASSET_GENERATION', 'CONTINUITY', 'EDIT']);
});

test('AI, planning, and EDIT stages have real production handlers', () => {
  assert.equal(typeof HANDLERS.IDEA, 'function');
  assert.equal(typeof HANDLERS.BRIEF, 'function');
  assert.equal(typeof HANDLERS.CONCEPT, 'function');
  assert.equal(typeof HANDLERS.SCRIPT, 'function');
  assert.equal(typeof HANDLERS.BIBLE, 'function');
  assert.equal(typeof HANDLERS.SHOT_PLAN, 'function');
  assert.equal(typeof HANDLERS.ASSET_PLAN, 'function');
  assert.equal(typeof HANDLERS.EDIT, 'function');
  assert.equal(HANDLERS.SIGNAL, undefined);
});

test('signal normalization never turns invalid input into creative truth', () => {
  assert.deepEqual(normalizeSignal(undefined), {});
  assert.deepEqual(normalizeSignal(null), {});
  assert.deepEqual(normalizeSignal('bad'), {});
  assert.deepEqual(normalizeSignal(['bad']), {});
  assert.deepEqual(normalizeSignal({ topic: 'test' }), { topic: 'test' });
});
