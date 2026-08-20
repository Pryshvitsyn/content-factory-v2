'use strict';

const assert = require('node:assert/strict');
const { validate, publicationGate } = require('../src/v2.1/validation-engine');

function run() {
  const pass = validate({
    artifactVersionId: 'av-1',
    validationType: 'schema',
    policy: { id: 'schema-v1' },
    checks: [
      { code: 'required_fields', ok: true, message: 'All required fields exist' },
      { code: 'types', ok: true, message: 'Types are valid' },
    ],
  });
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.score, 1);

  const warn = validate({
    artifactVersionId: 'av-1',
    validationType: 'content',
    policy: { id: 'content-v1' },
    checks: [
      { code: 'quality', ok: true, message: 'Quality passed' },
      { code: 'style', status: 'WARN', message: 'Style needs review' },
    ],
  });
  assert.equal(warn.status, 'WARN');

  const fail = validate({
    artifactVersionId: 'av-1',
    validationType: 'technical',
    policy: { id: 'technical-v1' },
    checks: [{ code: 'format', ok: false, message: 'Unsupported format' }],
  });
  assert.equal(fail.status, 'FAIL');

  const duplicate = validate({
    artifactVersionId: 'av-1',
    validationType: 'schema',
    policy: { id: 'schema-v1' },
    checks: [{ code: 'required_fields', ok: true, message: 'All required fields exist' }],
  });
  assert.equal(pass.identity, duplicate.identity);

  let gate = publicationGate({
    requiredTypes: ['schema', 'content', 'technical'],
    results: [pass, warn, fail],
  });
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.failed, ['technical']);

  gate = publicationGate({
    requiredTypes: ['schema', 'content'],
    results: [pass, warn],
  });
  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.warnings, ['content']);

  gate = publicationGate({
    requiredTypes: ['schema', 'readiness'],
    results: [pass],
  });
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing, ['readiness']);

  console.log('V2.1 VALIDATION ENGINE CERTIFICATION PASSED');
  console.log('PASS / WARN / FAIL / idempotent identity / publication gate / missing validation checks: OK');
}

run();
