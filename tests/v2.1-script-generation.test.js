'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildScriptRequest,
  fingerprint,
  stableStringify,
  validateScript,
} = require('../worker/v2.1-script-generation');

const ideaArtifact = {
  id: 'idea-artifact-1',
  version: 1,
  outputHash: 'idea-output-hash',
  value: {
    ideas: [
      { id: 'idea-1', title: 'One', premise: 'A', hook: 'H', angle: 'A1', rationale: 'R' },
      { id: 'idea-2', title: 'Two', premise: 'B', hook: 'H', angle: 'A2', rationale: 'R' },
      { id: 'idea-3', title: 'Three', premise: 'C', hook: 'H', angle: 'A3', rationale: 'R' },
    ],
  },
};

const conceptArtifact = {
  id: 'concept-artifact-1',
  version: 1,
  outputHash: 'concept-output-hash',
  value: {
    concept: 'The Moment Before the Choice',
    corePromise: 'A small moment of attention can make a meaningful decision clearer.',
    creativeThesis: 'The strongest decision begins when a person notices what they almost ignored.',
    narrativeApproach: 'Reveal the overlooked signal before the choice.',
    emotionalArc: 'routine -> uncertainty -> recognition -> confidence',
    visualWorld: 'Naturalistic close observation.',
    differentiation: 'Behavior makes the insight visible.',
    constraints: { compliance: ['no unsupported claims'] },
  },
};

test('SCRIPT request fingerprint is stable across object key order', () => {
  const a = buildScriptRequest({
    production: { id: 'p1', context_fingerprint: 'ctx', request_snapshot: { b: 2, a: 1 } },
    context: { brand: { rules: { x: true } } },
    idea: ideaArtifact,
    concept: conceptArtifact,
    signal: { topic: 'x' },
  });
  const b = buildScriptRequest({
    production: { context_fingerprint: 'ctx', request_snapshot: { a: 1, b: 2 }, id: 'p1' },
    context: { brand: { rules: { x: true } } },
    idea: { ...ideaArtifact, value: { ideas: [...ideaArtifact.value.ideas] } },
    concept: { ...conceptArtifact, value: { ...conceptArtifact.value } },
    signal: { topic: 'x' },
  });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(stableStringify(a), stableStringify(b));
});

test('SCRIPT request carries immutable production context and exact IDEA + CONCEPT provenance', () => {
  const request = buildScriptRequest({
    production: { id: 'p1', context_fingerprint: 'immutable-context', request_snapshot: { objective: 'conversion' } },
    context: { business: { id: 'b1' }, brand: { id: 'brand1' } },
    idea: ideaArtifact,
    concept: conceptArtifact,
  });
  assert.equal(request.production.contextFingerprint, 'immutable-context');
  assert.equal(request.production.request.objective, 'conversion');
  assert.equal(request.sources.ideaArtifactId, 'idea-artifact-1');
  assert.equal(request.sources.ideaArtifactVersion, 1);
  assert.equal(request.sources.ideaOutputHash, 'idea-output-hash');
  assert.equal(request.sources.idea.ideas[0].id, 'idea-1');
  assert.equal(request.sources.conceptArtifactId, 'concept-artifact-1');
  assert.equal(request.sources.conceptArtifactVersion, 1);
  assert.equal(request.sources.conceptOutputHash, 'concept-output-hash');
  assert.equal(request.sources.concept.concept, 'The Moment Before the Choice');
});

test('SCRIPT validator rejects malformed provider output before accepting cardinality', () => {
  assert.throws(() => validateScript({ title: 'x', logline: 'y', hook: 'z', scenes: [{ sceneNumber: 1 }] }), /Scene 1 is missing purpose/);
  assert.throws(() => validateScript({ title: 'x', logline: 'y', hook: 'z', scenes: [] }), /3-12 scenes/);
});

test('SCRIPT validator rejects non-contiguous scene numbering', () => {
  assert.throws(() => validateScript({
    title: 'x', logline: 'y', hook: 'z', scenes: [
      { sceneNumber: 1, purpose: 'p', visual: 'v', action: 'a', dialogue: 'd', audio: 'au' },
      { sceneNumber: 3, purpose: 'p', visual: 'v', action: 'a', dialogue: 'd', audio: 'au' },
      { sceneNumber: 4, purpose: 'p', visual: 'v', action: 'a', dialogue: 'd', audio: 'au' },
    ],
  }), /sceneNumber 2/);
});

test('SCRIPT validator accepts the canonical production shape', () => {
  assert.equal(validateScript({
    title: 'A Script',
    logline: 'A person discovers a useful truth.',
    hook: 'What if the obvious answer is wrong?',
    scenes: [1, 2, 3].map((sceneNumber) => ({
      sceneNumber,
      purpose: 'advance',
      visual: 'filmable action',
      action: 'character acts',
      dialogue: 'spoken line',
      audio: 'natural sound',
    })),
  }), true);
});
