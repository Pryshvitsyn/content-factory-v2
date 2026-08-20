'use strict';

const assert = require('node:assert/strict');
const {
  STAGE_ORDER,
  NON_AUTONOMOUS_GATES,
  REPAIR_AUTHORIZED_STAGES,
  assertStageTransition,
  assertAutomaticRepairAuthorized,
} = require('../worker/v2.1-production-contract');

// Every lifecycle transition is explicit and sequential.
for (let i = 0; i < STAGE_ORDER.length - 1; i += 1) {
  assert.doesNotThrow(() => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[i + 1]));
}

for (let i = 0; i < STAGE_ORDER.length; i += 1) {
  for (let j = 0; j < STAGE_ORDER.length; j += 1) {
    if (j === i + 1) continue;
    assert.throws(() => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[j]));
  }
}

assert.deepEqual(NON_AUTONOMOUS_GATES, ['HUMAN_APPROVAL']);
assert.deepEqual(REPAIR_AUTHORIZED_STAGES, ['OBJECTIVE_QA', 'DELIVERY_QA']);

// Subjective/unspecified findings cannot authorize automatic repair.
assert.throws(() => assertAutomaticRepairAuthorized('OBJECTIVE_QA', { kind: 'subjective_score' }));
assert.throws(() => assertAutomaticRepairAuthorized('OBJECTIVE_QA', null));
assert.throws(() => assertAutomaticRepairAuthorized('SCRIPT', { kind: 'objective_rule_violation' }));

// Explicit objective violations may authorize targeted repair.
assert.doesNotThrow(() => assertAutomaticRepairAuthorized(
  'OBJECTIVE_QA',
  { kind: 'objective_rule_violation', code: 'VISUAL_CONTINUITY' },
));
assert.doesNotThrow(() => assertAutomaticRepairAuthorized(
  'DELIVERY_QA',
  { kind: 'objective_rule_violation', code: 'PLATFORM_REQUIREMENT' },
));

console.log('V2.1 production contract: PASS');
