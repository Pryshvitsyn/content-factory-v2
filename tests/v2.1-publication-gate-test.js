'use strict';

const assert = require('node:assert/strict');
const { evaluatePublicationGate, assertPublicationReady } = require('../src/v2.1/publication-gate');

const result = (validation_type, status, created_at) => ({ validation_type, status, created_at });

const pass = evaluatePublicationGate({
  requiredValidations: ['schema', 'content'],
  results: [result('schema', 'PASS', '2026-08-20T10:00:00Z'), result('content', 'PASS', '2026-08-20T10:01:00Z')],
});
assert.equal(pass.allowed, true);
assert.deepEqual(pass.missing, []);

const warn = evaluatePublicationGate({
  requiredValidations: ['schema'],
  results: [result('schema', 'WARN', '2026-08-20T10:00:00Z')],
});
assert.equal(warn.allowed, true);
assert.equal(warn.warnings.length, 1);

const fail = evaluatePublicationGate({
  requiredValidations: ['schema', 'content'],
  results: [result('schema', 'PASS', '2026-08-20T10:00:00Z'), result('content', 'FAIL', '2026-08-20T10:01:00Z')],
});
assert.equal(fail.allowed, false);
assert.equal(fail.blocking.length, 1);

const missing = evaluatePublicationGate({
  requiredValidations: ['schema', 'content'],
  results: [result('schema', 'PASS', '2026-08-20T10:00:00Z')],
});
assert.equal(missing.allowed, false);
assert.deepEqual(missing.missing, ['content']);

const latestWins = evaluatePublicationGate({
  requiredValidations: ['schema'],
  results: [
    result('schema', 'FAIL', '2026-08-20T09:00:00Z'),
    result('schema', 'PASS', '2026-08-20T10:00:00Z'),
  ],
});
assert.equal(latestWins.allowed, true);

assert.throws(
  () => assertPublicationReady({ requiredValidations: ['content'], results: [result('content', 'FAIL', '2026-08-20T10:00:00Z')] }),
  (error) => error.code === 'PUBLICATION_BLOCKED'
);

console.log('V2.1 PUBLICATION GATE CERTIFICATION PASSED');
