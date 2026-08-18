'use strict';

const assert = require('node:assert/strict');
const {
  STAGE_ORDER,
  TERMINAL_STAGE,
  isTerminalStage,
  nextStage,
  previousStage,
  assertStageTransition,
} = require('../worker/v2.1-production-contract');

// Every non-terminal stage must have exactly one canonical successor.
for (let i = 0; i < STAGE_ORDER.length - 1; i += 1) {
  const from = STAGE_ORDER[i];
  const to = STAGE_ORDER[i + 1];

  assert.equal(nextStage(from), to);
  assert.equal(previousStage(to), from);
  assert.doesNotThrow(() => assertStageTransition(from, to));
}

// The first stage has no predecessor and the terminal stage has no successor.
assert.equal(previousStage(STAGE_ORDER[0]), null);
assert.equal(nextStage(TERMINAL_STAGE), null);
assert.equal(isTerminalStage(TERMINAL_STAGE), true);

// Skipping a stage is forbidden.
for (let i = 0; i < STAGE_ORDER.length - 2; i += 1) {
  assert.throws(
    () => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[i + 2]),
    /Invalid V2\.1 stage transition/
  );
}

// A terminal stage cannot transition back into the pipeline.
assert.throws(
  () => assertStageTransition(TERMINAL_STAGE, STAGE_ORDER[0]),
  /Invalid V2\.1 stage transition/
);

console.log('V2.1 stage sequence: PASS');
