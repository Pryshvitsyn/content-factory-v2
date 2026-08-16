'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BIBLE_CONTRACT_VERSION } = require('../worker/v2.1-bible-contract');
const { validateBible } = require('../worker/v2.1-bible-validator');
const { createBible, deriveEdition, canonicalJson, resolveContext } = require('../worker/v2.1-bible-engine');

function sample(overrides = {}) {
  return {
    context: {
      tenant: { id: 'tenant-1', name: 'Factory Customer' },
      business: { id: 'business-1', name: 'Roma Pizza', rules: { tone: 'local', narrative: { pacing: 'fast' } } },
      brand: { id: 'brand-1', name: 'Roma Pizza', rules: { brandRules: { claims: 'truthful' } } },
      audience: { id: 'audience-1', name: 'Rome locals', profile: { age: '18-40' } },
      offering: { id: 'offering-1', name: 'Pizza Margherita', rules: { productFocus: 'taste' } },
      strategy: { id: 'strategy-1', version: 3, objective: { objective: 'growth' } },
      universe: { id: 'universe-1', name: 'Roma Life' },
      series: { id: 'series-1', name: 'Coffee Counter', rules: { style: { energy: 'high' } } },
      production: { id: 'production-1', version: 1 },
    },
    version: 1,
    creativeTruth: {
      concept: 'A funny customer orders the wrong pizza.',
      narrative: { hook: 'Unexpected order', arc: ['setup', 'conflict', 'payoff'] },
      brandRules: { forbiddenClaims: ['medical claims'] },
      style: { visual: 'cinematic' },
      characters: [{ id: 'char-marco', version: 2, invariants: ['dark hair'], definition: { role: 'main' } }],
      locations: [{ id: 'loc-cafe', version: 1, definition: { type: 'Italian cafe' } }],
      styles: [{ id: 'style-series', version: 1, definition: { camera: '35mm' } }],
    },
    productionPlan: {
      objective: { cta: 'visit' },
      shots: [
        { number: 1, description: 'Marco enters', action: 'Marco enters the cafe', durationMs: 3000, continuityRequirements: [], assetRefs: [{ id: 'char-marco', type: 'CHARACTER', version: 2 }] },
        { number: 2, description: 'The order goes wrong', action: 'Marco orders the wrong pizza', durationMs: 4000, continuityRequirements: ['same character identity'], assetRefs: [{ id: 'char-marco', type: 'CHARACTER', version: 2 }] },
      ],
      assetRequirements: [{ role: 'main-character', type: 'CHARACTER', id: 'char-marco' }],
      editions: [
        { platform: 'TIKTOK', constraints: { aspectRatio: '9:16', maxDurationSec: 60 } },
        { platform: 'YOUTUBE_SHORTS', constraints: { aspectRatio: '9:16', maxDurationSec: 60 } },
      ],
    },
    ...overrides,
  };
}

test('contract version is tenant-aware and stable', () => {
  const bible = createBible(sample());
  assert.equal(bible.contractVersion, BIBLE_CONTRACT_VERSION);
  assert.equal(bible.context.references.tenant.id, 'tenant-1');
  assert.equal(bible.context.references.business.id, 'business-1');
  assert.equal(bible.context.references.brand.id, 'brand-1');
});

test('production cannot silently accept a different resolved context fingerprint', () => {
  const resolved = resolveContext(sample().context);
  assert.throws(() => createBible({ ...sample(), expectedContextFingerprint: 'ctx_not_this_production' }), /immutable production context/);
  assert.doesNotThrow(() => createBible({ ...sample(), expectedContextFingerprint: resolved.fingerprint }));
});

test('business rules are inherited while production rules can override them', () => {
  const bible = createBible(sample({
    context: {
      ...sample().context,
      business: { id: 'business-1', name: 'Roma Pizza', rules: { tone: 'local', narrative: { pacing: 'slow', language: 'it' } } },
    },
    creativeTruth: {
      ...sample().creativeTruth,
      narrative: { pacing: 'fast' },
    },
  }));

  assert.equal(bible.creativeTruth.narrative.pacing, 'fast');
  assert.equal(bible.creativeTruth.narrative.language, 'it');
});

test('same creative request produces the same immutable bible ID', () => {
  const a = createBible(sample());
  const b = createBible(sample());
  assert.equal(a.id, b.id);
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('different businesses cannot accidentally share the same bible fingerprint', () => {
  const a = createBible(sample());
  const input = sample();
  input.context.business = { id: 'business-2', name: 'Another Business', rules: {} };
  const b = createBible(input);
  assert.notEqual(a.id, b.id);
});

test('recurring character identity is referenced by stable ID and version', () => {
  const bible = createBible(sample());
  const character = bible.creativeTruth.characters[0];
  assert.equal(character.id, 'char-marco');
  assert.equal(character.version, 2);
  assert.deepEqual(character.invariants, ['dark hair']);
});

test('AI provider configuration is forbidden in creative truth', () => {
  const bible = createBible(sample());
  assert.equal(JSON.stringify(bible).includes('nvidia'), false);
  assert.equal(JSON.stringify(bible).includes('openai'), false);
  assert.equal(JSON.stringify(bible).includes('providerConfig'), false);
});

test('platform editions are derived without changing the canonical bible', () => {
  const bible = createBible(sample());
  const before = canonicalJson(bible);
  const edition = deriveEdition(bible, 'TIKTOK');

  assert.equal(edition.platform, 'TIKTOK');
  assert.equal(edition.bibleId, bible.id);
  assert.equal(canonicalJson(bible), before);
});

test('learning context can remain business-scoped', () => {
  const bible = createBible(sample({
    context: {
      ...sample().context,
      business: {
        ...sample().context.business,
        rules: { learningScope: 'BUSINESS_ONLY' },
      },
    },
  }));

  assert.equal(bible.context.inheritedRules.learningScope, 'BUSINESS_ONLY');
});

test('validator rejects non-contiguous shot numbering', () => {
  const input = sample();
  input.productionPlan.shots[1].number = 3;
  assert.throws(() => createBible(input), /shot numbers must be deterministic and contiguous/);
});

test('validator rejects provider configuration', () => {
  const bible = createBible(sample());
  assert.throws(() => validateBible({ ...bible, providerConfig: { provider: 'NVIDIA' } }), /provider configuration/);
});

test('validator requires at least one platform edition', () => {
  const input = sample();
  input.productionPlan.editions = [];
  assert.throws(() => createBible(input), /must contain at least one edition/);
});
