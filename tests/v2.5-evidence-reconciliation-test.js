'use strict';

const assert = require('node:assert/strict');
const { reconcileEvidence } = require('../worker/v2.5-evidence-reconciliation');

const sources = [
  { source_id: 'a', url: 'https://alpha.example/a', title: 'Alpha', publisher: 'Alpha', independence_group: 'alpha', retrieved_at: '2026-08-21T07:00:00.000Z' },
  { source_id: 'b', url: 'https://beta.example/b', title: 'Beta', publisher: 'Beta', independence_group: 'beta', retrieved_at: '2026-08-21T07:00:00.000Z' },
  { source_id: 'a-copy', url: 'https://alpha.example/reprint', title: 'Alpha reprint', publisher: 'Alpha', independence_group: 'alpha', retrieved_at: '2026-08-21T07:00:00.000Z' }
];

const corroborated = reconcileEvidence({
  sources,
  claims: [{ claim_id: 'c1', claim: 'Supported signal', classification: 'FACT', confidence: 'HIGH', source_ids: ['a', 'b'] }]
});
assert.equal(corroborated.claims[0].independent_source_count, 2);
assert.equal(corroborated.claims[0].corroborated, true);
assert.equal(corroborated.confidence, 'HIGH');
assert.equal(corroborated.independent_source_count, 2);

const copied = reconcileEvidence({
  sources,
  claims: [{ claim: 'Copied signal', classification: 'FACT', confidence: 'HIGH', source_ids: ['a', 'a-copy'] }]
});
assert.equal(copied.claims[0].independent_source_count, 1);
assert.equal(copied.claims[0].corroborated, false);
assert.equal(copied.confidence, 'MEDIUM');

const contradicted = reconcileEvidence({
  sources,
  claims: [{ claim: 'Conflicted signal', classification: 'INFERENCE', confidence: 'HIGH', source_ids: ['a', 'b'], contradictions: [{ against_source_id: 'b', reason: 'different geography' }] }]
});
assert.equal(contradicted.contradictions_found, true);
assert.equal(contradicted.confidence, 'LOW');

assert.throws(() => reconcileEvidence({ sources, claims: [{ claim: 'bad', classification: 'FACT', source_ids: ['missing'] }] }), /unknown source/);

console.log('V2.5 evidence reconciliation certification: PASS');
