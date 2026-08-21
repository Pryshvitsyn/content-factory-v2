'use strict';

const assert = require('node:assert/strict');
const { STAGE_ORDER } = require('../worker/v2.1-production-contract');
const { getStageSpec, getPipelineSpec, canAutoRepair } = require('../worker/v2.2-stage-spec');

const pipeline = getPipelineSpec();
assert.equal(pipeline.length, 19);
assert.deepEqual(pipeline.map((x) => x.stage), STAGE_ORDER);

for (const stage of STAGE_ORDER) {
  const spec = getStageSpec(stage);
  assert.ok(spec.mode);
  assert.ok(Array.isArray(spec.input));
  assert.ok(Array.isArray(spec.output));
  assert.equal(typeof spec.humanGate, 'boolean');
  assert.equal(typeof spec.repairable, 'boolean');
}

assert.equal(getStageSpec('HUMAN_APPROVAL').humanGate, true);
assert.equal(canAutoRepair('OBJECTIVE_QA'), true);
assert.equal(canAutoRepair('HUMAN_APPROVAL'), false);
assert.equal(canAutoRepair('PUBLISH'), false);
assert.deepEqual(getStageSpec('MASTER').output, ['master_video']);
assert.deepEqual(getStageSpec('DELIVERY').output, ['delivery_packages']);
assert.deepEqual(getStageSpec('LEARN').output, ['learning_record']);

assert.throws(() => getStageSpec('NOT_A_STAGE'), /Unknown stage/);

console.log('V2.2 stage execution specifications: PASS');
