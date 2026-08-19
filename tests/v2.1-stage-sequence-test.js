'use strict';

const assert = require('node:assert/strict');
const {
  STAGE_ORDER,
  TERMINAL_STAGE,
  STAGE_DEFINITIONS,
  isTerminalStage,
  nextStage,
  previousStage,
  stageIndex,
  assertStageTransition,
} = require('../worker/v2.1-production-contract');

const expectedStages = [
  'SIGNAL', 'IDEA', 'BRIEF', 'BIBLE', 'CONCEPT', 'SCRIPT',
  'SHOT_PLAN', 'ASSET_PLAN', 'ASSETS', 'EDIT', 'PLATFORM_ADAPTATION',
  'VALIDATION', 'PUBLISH', 'ANALYZE', 'LEARN',
];

assert.deepEqual(STAGE_ORDER, expectedStages);
assert.equal(STAGE_ORDER.length, 15);
assert.equal(TERMINAL_STAGE, 'LEARN');
assert.equal(Object.keys(STAGE_DEFINITIONS).length, STAGE_ORDER.length);

for (let i = 0; i < STAGE_ORDER.length; i += 1) {
  const stage = STAGE_ORDER[i];
  const definition = STAGE_DEFINITIONS[stage];

  assert.ok(definition);
  assert.equal(definition.order, i + 1);
  assert.equal(definition.stage, stage);
  assert.equal(definition.retryable, true);
  assert.equal(definition.requiresPreviousStage, i > 0);
  assert.equal(definition.terminal, stage === TERMINAL_STAGE);
  assert.equal(stageIndex(stage), i + 1);
  assert.equal(previousStage(stage), i === 0 ? null : STAGE_ORDER[i - 1]);
  assert.equal(nextStage(stage), i === STAGE_ORDER.length - 1 ? null : STAGE_ORDER[i + 1]);
}

for (let i = 0; i < STAGE_ORDER.length - 1; i += 1) {
  const from = STAGE_ORDER[i];
  const to = STAGE_ORDER[i + 1];
  assert.doesNotThrow(() => assertStageTransition(from, to));
}

for (let i = 0; i < STAGE_ORDER.length - 2; i += 1) {
  assert.throws(
    () => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[i + 2]),
    /Invalid V2\.1 stage transition/
  );
}

assert.equal(previousStage('SIGNAL'), null);
assert.equal(nextStage('LEARN'), null);
assert.equal(isTerminalStage('LEARN'), true);
assert.throws(() => assertStageTransition('LEARN', 'SIGNAL'), /Invalid V2\.1 stage transition/);
assert.throws(() => nextStage('NOT_A_STAGE'), /Unknown V2\.1 stage/);
assert.throws(() => previousStage('NOT_A_STAGE'), /Unknown V2\.1 stage/);

console.log('V2.1 stage sequence: PASS');
