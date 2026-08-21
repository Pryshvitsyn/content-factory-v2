'use strict';

const assert = require('node:assert/strict');
const { evaluate } = require('../worker/v2.3-quality-engine');

const artifactId = 'artifact-quality-cert';

const pass = evaluate({ artifactId });
assert.equal(pass.status, 'PASS');

const anatomy = evaluate({
  artifactId,
  findings: [{
    rule_id: 'ANATOMY.EXTRA_LIMB',
    scope: { scene_id: 'scene-01' },
    message: 'extra limb detected',
    repair_strategy: 'regenerate_affected_shot'
  }]
});
assert.equal(anatomy.status, 'REPAIR');
assert.equal(anatomy.unresolved_block_count, 1);

const exhausted = evaluate({
  artifactId,
  repairAttempts: 2,
  findings: [{
    rule_id: 'ANATOMY.EXTRA_LIMB',
    scope: { scene_id: 'scene-01' },
    message: 'extra limb persists',
    repair_strategy: 'regenerate_affected_shot'
  }]
});
assert.equal(exhausted.status, 'BLOCK');

const exception = evaluate({
  artifactId,
  findings: [{
    rule_id: 'ANATOMY.EXTRA_LIMB',
    scope: { scene_id: 'scene-01' },
    message: 'fictional creature has three arms'
  }],
  exceptions: [{
    exception_id: '11111111-1111-4111-8111-111111111111',
    rule_id: 'ANATOMY.EXTRA_LIMB',
    scope: { scene_id: 'scene-01' },
    reason: 'explicit fictional creature design',
    approved_by_policy: true
  }]
});
assert.equal(exception.status, 'PASS');
assert.equal(exception.findings[0].excepted, true);

const unknownRule = evaluate({
  artifactId,
  findings: [{
    rule_id: 'UNKNOWN.RULE',
    scope: { scene_id: 'scene-02' },
    message: 'unknown validator output'
  }]
});
assert.equal(unknownRule.status, 'BLOCK');

console.log('V2.3 quality engine certification: PASS');
