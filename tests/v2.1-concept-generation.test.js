'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConceptRequest, fingerprint, stableStringify, validateConcept } = require('../worker/v2.1-concept-generation');

const production = {
  id: 'p1',
  context_fingerprint: 'immutable-context',
  request_snapshot: { objective: 'conversion' },
};

const context = {
  business: { id: 'b1', rules: { tone: 'clear' } },
  brand: { id: 'brand1', voice: 'human' },
  strategy: { objective: { primary: 'conversion' } },
};

const brief = {
  id: 'brief-1',
  version: 1,
  outputHash: 'brief-hash',
  value: { objective: 'conversion', audience: 'buyers', promise: 'Make the decision clearer.' },
};

test('CONCEPT request fingerprint is stable across object key order', () => {
  const a = buildConceptRequest({ production, context, brief, signal: { topic: 'x' } });
  const b = buildConceptRequest({
    production: { request_snapshot: { objective: 'conversion' }, context_fingerprint: 'immutable-context', id: 'p1' },
    context: { strategy: { objective: { primary: 'conversion' } }, brand: { voice: 'human', id: 'brand1' }, business: { rules: { tone: 'clear' }, id: 'b1' } },
    brief: { value: { promise: 'Make the decision clearer.', audience: 'buyers', objective: 'conversion' }, outputHash: 'brief-hash', version: 1, id: 'brief-1' },
    signal: { topic: 'x' },
  });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(stableStringify(a), stableStringify(b));
});

test('CONCEPT request carries immutable production context and exact BRIEF provenance', () => {
  const request = buildConceptRequest({ production, context, brief, signal: { topic: 'test' } });
  assert.equal(request.production.contextFingerprint, 'immutable-context');
  assert.equal(request.sources.briefArtifactId, 'brief-1');
  assert.equal(request.sources.briefArtifactVersion, 1);
  assert.equal(request.sources.briefOutputHash, 'brief-hash');
});

test('CONCEPT validator rejects malformed provider output', () => {
  assert.throws(() => validateConcept({ concept: 'A concept' }), /missing corePromise/);
});

test('CONCEPT validator accepts canonical output shape', () => {
  assert.equal(validateConcept({
    concept: 'The human turn',
    corePromise: 'Make the choice feel clear.',
    creativeThesis: 'The smallest observation can change the decision.',
    narrativeApproach: 'Begin in routine, reveal tension, resolve through a human choice.',
    emotionalArc: 'curiosity -> tension -> recognition -> confidence',
    visualWorld: 'Naturalistic, intimate, concrete environments.',
    differentiation: 'Emotion is demonstrated through behavior rather than explained.',
    constraints: { compliance: ['no unsupported claims'], production: ['filmable'] },
  }), true);
});
