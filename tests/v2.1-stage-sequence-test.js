'use strict';

const assert = require('node:assert/strict');
const { STAGE_ORDER, assertStageTransition } = require('../worker/v2.1-production-contract');

// Contract-level sequence test: every production must advance strictly through
// the canonical stage order. Skipping or going backwards is invalid.
for (let i = 0; i < STAGE_ORDER.length - 1; i += 1) {
  assert.doesNotThrow(() => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[i + 1]));
}

for (let i = 0; i < STAGE_ORDER.length; i += 1) {
  for (let j = 0; j < STAGE_ORDER.length; j += 1) {
    if (j === i + 1) continue;
    assert.throws(() => assertStageTransition(STAGE_ORDER[i], STAGE_ORDER[j]));
  }
}

console.log('V2.1 stage sequence: PASS');
