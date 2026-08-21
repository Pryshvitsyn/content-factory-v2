'use strict';

const assert = require('node:assert/strict');
const { planNextStage } = require('../worker/v2.4-production-brain');

const blocked = planNextStage({ requestedStage: 'SCRIPT', artifacts: {
  CONTENT_BIBLE: { fingerprint: 'bible-1' }
}});
assert.equal(blocked.status, 'BLOCK');
assert.deepEqual(blocked.missing_inputs, ['CONCEPT']);

const ready = planNextStage({ requestedStage: 'SCRIPT', artifacts: {
  CONTENT_BIBLE: { fingerprint: 'bible-1' },
  CONCEPT: { fingerprint: 'concept-1' }
}});
assert.equal(ready.status, 'READY');
assert.equal(ready.output_type, 'SCRIPT');
assert.equal(ready.requires_independent_validation, true);
assert.equal(ready.self_approval_forbidden, true);
assert.match(ready.input_fingerprint, /^[a-f0-9]{64}$/);

assert.throws(
  () => planNextStage({ requestedStage: 'NOT_A_STAGE', artifacts: {} }),
  /Unknown production brain stage/
);

console.log('V2.4 production brain certification: PASS');
