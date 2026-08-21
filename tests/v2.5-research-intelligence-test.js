'use strict';

const assert = require('node:assert/strict');
const { buildResearch } = require('../worker/v2.5-research-intelligence');

const retrievedAt = '2026-08-21T07:00:00.000Z';
const research = buildResearch({
  sources: [{ source_id: 'src-1', url: 'https://example.com/a', title: 'Source A', retrieved_at: retrievedAt }, { source_id: 'src-2', url: 'https://example.com/b', title: 'Source B', retrieved_at: retrievedAt }],
  claims: [{ claim: 'A verified signal', classification: 'FACT', confidence: 'HIGH', source_ids: ['src-1', 'src-2'] }],
  independentSourceCount: 2,
  contradictionsFound: false
});
assert.equal(research.confidence, 'HIGH');
assert.equal(research.claims[0].source_ids.length, 2);

const contradicted = buildResearch({
  sources: [{ source_id: 'src-3', url: 'https://example.com/c', title: 'Source C', retrieved_at: retrievedAt }],
  claims: [{ claim: 'Conflicting signal', classification: 'INFERENCE', confidence: 'HIGH', source_ids: ['src-3'] }],
  independentSourceCount: 1,
  contradictionsFound: true
});
assert.equal(contradicted.confidence, 'LOW');

assert.throws(() => buildResearch({
  sources: [],
  claims: [{ claim: 'Unsupported', classification: 'FACT', confidence: 'HIGH', source_ids: ['missing'] }]
}), /known sources/);

console.log('V2.5 research intelligence certification: PASS');
