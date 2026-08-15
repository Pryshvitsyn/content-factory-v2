'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIRST_VERTICAL_SLICE,
  HANDLERS,
  normalizeSignal,
} = require('../worker/v2.1-production-orchestrator');

test('vertical slice is explicit and ordered from signal through script', () => {
  assert.deepEqual(FIRST_VERTICAL_SLICE, ['SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT']);
});

test('AI stages have real production handlers and signal remains deterministic', () => {
  assert.equal(typeof HANDLERS.IDEA, 'function');
  assert.equal(typeof HANDLERS.BRIEF, 'function');
  assert.equal(typeof HANDLERS.CONCEPT, 'function');
  assert.equal(typeof HANDLERS.SCRIPT, 'function');
  assert.equal(HANDLERS.SIGNAL, undefined);
});

test('signal normalization never turns invalid input into creative truth', () => {
  assert.deepEqual(normalizeSignal(undefined), {});
  assert.deepEqual(normalizeSignal(null), {});
  assert.deepEqual(normalizeSignal('bad'), {});
  assert.deepEqual(normalizeSignal(['bad']), {});
  assert.deepEqual(normalizeSignal({ topic: 'test' }), { topic: 'test' });
});
