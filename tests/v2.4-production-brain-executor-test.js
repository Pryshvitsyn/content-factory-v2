'use strict';

const assert = require('node:assert/strict');
const { executeStage } = require('../worker/v2.4-production-brain-executor');

(async () => {
  let providerCalls = 0;
  let repairs = 0;

  const result = await executeStage({
    stage: 'INTENT',
    artifacts: { IDEA: { fingerprint: 'idea-1', payload: 'Make a useful short video' } },
    provider: async () => {
      providerCalls += 1;
      return { objective: 'create a useful short video', audience: 'general' };
    },
    validate: async ({ attempt }) => attempt === 0
      ? { status: 'REPAIR', finding: 'missing measurable objective' }
      : { status: 'PASS' },
    repair: async ({ proposal }) => {
      repairs += 1;
      return { ...proposal, objective: 'create a useful short video with one clear takeaway' };
    }
  });

  assert.equal(result.status, 'PASS');
  assert.equal(providerCalls, 1);
  assert.equal(repairs, 1);
  assert.equal(result.artifact.type, 'INTENT');
  assert.match(result.artifact.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.artifact.source_input_fingerprint.length, 64);

  const blocked = await executeStage({
    stage: 'SCRIPT',
    artifacts: { CONTENT_BIBLE: { fingerprint: 'bible-1' } },
    provider: async () => ({})
  });
  assert.equal(blocked.status, 'BLOCK');
  assert.deepEqual(blocked.missing_inputs, ['CONCEPT']);

  let calls = 0;
  const exhausted = await executeStage({
    stage: 'INTENT',
    artifacts: { IDEA: { fingerprint: 'idea-2' } },
    provider: async () => ({ value: ++calls }),
    validate: async () => ({ status: 'REPAIR', finding: 'still invalid' }),
    repair: async ({ proposal }) => proposal
  });
  assert.equal(exhausted.status, 'BLOCK');
  assert.equal(exhausted.repair_attempts, 2);
  assert.equal(calls, 1);

  console.log('V2.4 production brain executor certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
