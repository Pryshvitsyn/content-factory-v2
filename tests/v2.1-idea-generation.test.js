'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIdeaRequest, fingerprint, stableStringify, validateIdeaSet } = require('../worker/v2.1-idea-generation');

test('IDEA request fingerprint is stable across object key order', () => {
  const a = { production: { id: 'p1', request: { b: 2, a: 1 }, contextFingerprint: 'ctx' }, context: { brand: { rules: { x: true } } }, input: { signal: { topic: 'x' } } };
  const b = { production: { contextFingerprint: 'ctx', request: { a: 1, b: 2 }, id: 'p1' }, input: { signal: { topic: 'x' } }, context: { brand: { rules: { x: true } } } };
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(stableStringify(a), stableStringify(b));
});

test('IDEA request contains the immutable production context fingerprint', () => {
  const request = buildIdeaRequest({
    production: { id: 'p1', context_fingerprint: 'immutable-context', request_snapshot: { objective: 'conversion' } },
    context: { business: { id: 'b1' }, brand: { id: 'brand1' } },
    signal: { topic: 'test' },
  });
  assert.equal(request.production.contextFingerprint, 'immutable-context');
  assert.equal(request.production.request.objective, 'conversion');
});

test('IDEA validator rejects malformed provider output', () => {
  assert.throws(() => validateIdeaSet({ ideas: [{ id: '1' }] }), /missing title/);
});

test('IDEA validator accepts the canonical output shape', () => {
  assert.equal(validateIdeaSet({ ideas: [
    { id: '1', title: 'A', premise: 'A', hook: 'A', angle: 'A', rationale: 'A' },
    { id: '2', title: 'B', premise: 'B', hook: 'B', angle: 'B', rationale: 'B' },
    { id: '3', title: 'C', premise: 'C', hook: 'C', angle: 'C', rationale: 'C' },
  ] }), true);
});
