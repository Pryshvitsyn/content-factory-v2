'use strict';

const assert = require('node:assert/strict');
const { executeBrainStage } = require('../worker/v2.4-ai-production-brain');

(async () => {
  const provider = async ({ stage }) => ({ stage, result: `generated-${stage}` });
  const validate = async () => ({ status: 'PASS' });

  const missing = await executeBrainStage({
    stage: 'RESEARCH',
    artifacts: { IDEA: { fingerprint: 'idea-1' } },
    provider,
    validate
  });
  assert.equal(missing.status, 'BLOCK');
  assert.deepEqual(missing.missing_inputs, ['INTENT']);

  const passed = await executeBrainStage({
    stage: 'INTENT',
    artifacts: { IDEA: { fingerprint: 'idea-1' } },
    provider,
    validate
  });
  assert.equal(passed.status, 'PASS');
  assert.equal(passed.artifact.artifact_type, 'INTENT');
  assert.match(passed.artifact.fingerprint, /^[a-f0-9]{64}$/);

  let validations = 0;
  const repaired = await executeBrainStage({
    stage: 'INTENT',
    artifacts: { IDEA: { fingerprint: 'idea-1' } },
    provider,
    validate: async () => {
      validations += 1;
      return validations === 1 ? { status: 'BLOCK', reason: 'objective mismatch' } : { status: 'PASS' };
    },
    repair: async ({ proposal }) => ({ ...proposal, repaired: true })
  });
  assert.equal(repaired.status, 'PASS');
  assert.equal(repaired.repair_attempts, 1);

  const escalated = await executeBrainStage({
    stage: 'INTENT',
    artifacts: { IDEA: { fingerprint: 'idea-1' } },
    provider,
    validate: async () => ({ status: 'BLOCK', reason: 'persistent objective mismatch' }),
    repair: async ({ proposal }) => proposal
  });
  assert.equal(escalated.status, 'HUMAN_REVIEW');
  assert.equal(escalated.repair_attempts, 2);

  await assert.rejects(
    executeBrainStage({ stage: 'INTENT', artifacts: { IDEA: { fingerprint: 'idea-1' } } }),
    /provider and validate must be functions/
  );

  console.log('V2.4 AI production brain certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
