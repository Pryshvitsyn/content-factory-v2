'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RESOLVER_VERSION,
  resolveContext,
  canonicalJson,
} = require('../worker/v2.1-context-resolver');

function sample(overrides = {}) {
  return {
    tenant: {
      id: 'tenant-1',
      version: 1,
      name: 'Customer One',
      metadata: { locale: 'it-IT' },
    },
    business: {
      id: 'business-1',
      version: 2,
      name: 'Construction Co',
      industry: 'CONSTRUCTION',
      rules: {
        tone: 'direct',
        language: 'it',
        narrative: { pacing: 'medium', structure: 'problem-solution' },
      },
    },
    brand: {
      id: 'brand-1',
      version: 3,
      name: 'BuildPro',
      voice: { personality: 'confident' },
      visualIdentity: { palette: 'brand', typography: 'modern' },
      rules: { narrative: { hookStyle: 'visual' } },
      complianceRules: { claims: 'verified-only' },
    },
    audience: {
      id: 'audience-1',
      version: 1,
      name: 'Home owners',
      profile: { painPoints: ['cost', 'trust'] },
    },
    offering: {
      id: 'offering-1',
      version: 1,
      name: 'Bathroom renovation',
      offeringType: 'SERVICE',
      description: 'Full renovation',
      claims: ['fixed-price'],
    },
    strategy: {
      id: 'strategy-1',
      version: 4,
      objective: { goal: 'qualified-leads' },
      pillars: ['education', 'proof'],
      platformRules: { TIKTOK: { hookSeconds: 2 } },
      trendRules: { allowTrendAdaptation: true },
      learningPolicy: { scope: 'BUSINESS' },
    },
    universe: {
      id: 'universe-1',
      version: 1,
      name: 'Real Renovations',
      premise: 'Real problems, real transformations',
      rules: { narrative: { pacing: 'fast' } },
    },
    series: {
      id: 'series-1',
      version: 2,
      name: 'Before / After',
      formatRules: { durationSec: { min: 15, max: 45 } },
      narrativeRules: { structure: ['problem', 'process', 'result'] },
    },
    production: {
      id: 'production-1',
      version: 1,
      rules: { narrative: { pacing: 'very-fast' } },
    },
    ...overrides,
  };
}

test('resolver is versioned and returns every supplied reference', () => {
  const resolved = resolveContext(sample());
  assert.equal(resolved.resolverVersion, RESOLVER_VERSION);
  assert.equal(resolved.references.tenant.id, 'tenant-1');
  assert.equal(resolved.references.business.version, 2);
  assert.equal(resolved.references.brand.version, 3);
  assert.equal(resolved.references.strategy.version, 4);
  assert.equal(resolved.references.production.id, 'production-1');
});

test('higher creative layers override lower layers deterministically', () => {
  const resolved = resolveContext(sample());
  assert.equal(resolved.effective.rules.tone, 'direct');
  assert.equal(resolved.effective.rules.language, 'it');
  assert.equal(resolved.effective.rules.narrative.pacing, 'very-fast');
  assert.equal(resolved.effective.rules.narrative.hookStyle, 'visual');
});

test('domain payloads survive resolution without flattening creative meaning', () => {
  const resolved = resolveContext(sample());
  assert.equal(resolved.effective.voice.personality, 'confident');
  assert.equal(resolved.effective.visualIdentity.typography, 'modern');
  assert.deepEqual(resolved.effective.profile.painPoints, ['cost', 'trust']);
  assert.equal(resolved.effective.description, 'Full renovation');
  assert.deepEqual(resolved.effective.claims, ['fixed-price']);
  assert.deepEqual(resolved.effective.pillars, ['education', 'proof']);
  assert.equal(resolved.effective.premise, 'Real problems, real transformations');
  assert.deepEqual(resolved.effective.formatRules.durationSec, { min: 15, max: 45 });
});

test('same context produces the same fingerprint regardless of object key order', () => {
  const a = resolveContext(sample());
  const b = resolveContext({
    ...sample(),
    business: {
      name: 'Construction Co',
      rules: {
        narrative: { structure: 'problem-solution', pacing: 'medium' },
        language: 'it',
        tone: 'direct',
      },
      industry: 'CONSTRUCTION',
      version: 2,
      id: 'business-1',
    },
  });

  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('changing business identity changes the resolved fingerprint', () => {
  const a = resolveContext(sample());
  const b = resolveContext({
    ...sample(),
    business: { ...sample().business, id: 'business-2' },
  });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('required isolation layers cannot be omitted', () => {
  for (const layer of ['tenant', 'business', 'brand']) {
    const input = sample();
    delete input[layer];
    assert.throws(() => resolveContext(input), new RegExp(`context\\.${layer} is required`));
  }
});

test('provider configuration is rejected anywhere in context', () => {
  const input = sample();
  input.brand.rules.provider = 'NVIDIA';
  assert.throws(() => resolveContext(input), /must not contain provider configuration/);
});

test('provider model configuration is rejected even when nested', () => {
  const input = sample();
  input.strategy.trendRules.generation = { modelConfig: { temperature: 0.7 } };
  assert.throws(() => resolveContext(input), /must not contain provider configuration/);
});

test('sources preserve precedence order for auditability', () => {
  const resolved = resolveContext(sample());
  assert.deepEqual(
    resolved.sources.map(source => source.layer),
    ['tenant', 'business', 'brand', 'audience', 'offering', 'strategy', 'universe', 'series', 'production']
  );
});

test('resolution does not mutate input objects', () => {
  const input = sample();
  const before = JSON.stringify(input);
  resolveContext(input);
  assert.equal(JSON.stringify(input), before);
});
