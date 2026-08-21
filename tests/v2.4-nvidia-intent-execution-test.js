'use strict';

const assert = require('node:assert/strict');
const { createNvidiaIntentExecutor } = require('../worker/v2.4-nvidia-intent-execution');

assert.throws(() => createNvidiaIntentExecutor(), /NVIDIA_API_KEY is required/);

const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  assert.match(url, /example\.invalid/);
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(body.messages[1].role, 'user');
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { content: '{"objective":"Create a useful educational video"}' } }] };
    }
  };
};

const executor = createNvidiaIntentExecutor({
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1'
});

(async () => {
  const result = await executor({
    idea: 'Create a useful educational video',
    validate: async ({ stage, proposal }) => {
      assert.equal(stage, 'INTENT');
      assert.equal(proposal.stage, 'INTENT');
      return { status: 'PASS' };
    }
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.stage, 'INTENT');
  assert.equal(result.artifact.artifact_type, 'INTENT');
  assert.equal(result.repair_attempts, 0);
  console.log('V2.4 NVIDIA INTENT execution wiring certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
});
