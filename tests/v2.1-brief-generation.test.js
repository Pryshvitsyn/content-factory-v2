'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBriefRequest, fingerprint, stableStringify, validateBrief } = require('../worker/v2.1-brief-generation');

const IDEA = {
  id: 'idea-artifact-1', version: 1, outputHash: 'idea-hash',
  value: { ideas: [{ id: 'idea-1', title: 'The Notice', premise: 'A small observation changes a decision.', hook: 'What if the thing you ignored was the answer?', angle: 'human', rationale: 'Emotion before explanation.' }] },
};

test('BRIEF request fingerprint is stable across object key order', () => {
  const a = buildBriefRequest({ production: { id: 'p1', request_snapshot: { b: 2, a: 1 }, context_fingerprint: 'ctx' }, context: { brand: { rules: { x: true } } }, idea: IDEA, signal: { topic: 'x' } });
  const b = buildBriefRequest({ production: { context_fingerprint: 'ctx', request_snapshot: { a: 1, b: 2 }, id: 'p1' }, signal: { topic: 'x' }, context: { brand: { rules: { x: true } } }, idea: { value: IDEA.value, outputHash: 'idea-hash', version: 1, id: 'idea-artifact-1' } });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(stableStringify(a), stableStringify(b));
});

test('BRIEF request carries immutable production context and exact IDEA provenance', () => {
  const request = buildBriefRequest({ production: { id: 'p1', context_fingerprint: 'immutable-context', request_snapshot: { objective: 'conversion' } }, context: { business: { id: 'b1' } }, idea: IDEA });
  assert.equal(request.production.contextFingerprint, 'immutable-context');
  assert.equal(request.sources.ideaArtifactId, 'idea-artifact-1');
  assert.equal(request.sources.ideaArtifactVersion, 1);
  assert.equal(request.sources.ideaOutputHash, 'idea-hash');
});

test('BRIEF validator rejects malformed provider output', () => {
  assert.throws(() => validateBrief({ objective: 'x' }), /missing audience/);
});

test('BRIEF validator accepts canonical output shape', () => {
  assert.equal(validateBrief({ objective: 'conversion', audience: 'buyers', promise: 'clarity', keyMessage: 'Notice more.', cta: 'Learn more.', creativeDirection: 'human and precise', constraints: { compliance: ['no unsupported claims'] } }), true);
});