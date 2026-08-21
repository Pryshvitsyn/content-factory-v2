'use strict';

const assert = require('node:assert/strict');
const {
  STAGE_ORDER,
  TERMINAL_STAGE,
  getStageDefinition,
  isValidStage,
  nextStage,
  previousStage,
  stageIndex,
  assertStageTransition,
} = require('../worker/v2.1-production-contract');

assert.ok(Array.isArray(STAGE_ORDER));
assert.equal(STAGE_ORDER.length, 19);
assert.equal(STAGE_ORDER[0], 'SIGNAL');
assert.equal(TERMINAL_STAGE, 'LEARN');

for (let i = 0; i < STAGE_ORDER.length; i += 1) {
  const stage = STAGE_ORDER[i];
  const definition = getStageDefinition(stage);
  assert.equal(definition.stage, stage);
  assert.equal(definition.order, i + 1);
  assert.equal(stageIndex(stage), i + 1);
  assert.equal(isValidStage(stage), true);
  assert.equal(previousStage(stage), i === 0 ? null : STAGE_ORDER[i - 1]);
  assert.equal(nextStage(stage), i === STAGE_ORDER.length - 1 ? null : STAGE_ORDER[i + 1]);
  if (i < STAGE_ORDER.length - 1) {
    assert.doesNotThrow(() => assertStageTransition(stage, STAGE_ORDER[i + 1]));
  }
}

assert.equal(getStageDefinition('SIGNAL').requiresPreviousStage, false);
assert.equal(getStageDefinition('LEARN').terminal, true);
assert.throws(() => getStageDefinition('NOT_A_STAGE'), /Unknown V2\.1 stage/);
assert.throws(() => assertStageTransition('SIGNAL', 'BRIEF'), /Invalid V2\.1 stage transition/);
assert.throws(() => assertStageTransition('LEARN', 'SIGNAL'), /Invalid V2\.1 stage transition/);

console.log('V2.1 stage sequence: PASS');
