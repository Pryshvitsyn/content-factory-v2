'use strict';

const assert = require('node:assert/strict');
const { createNvidiaIntentExecutor } = require('../worker/v2.4-nvidia-intent-execution');

assert.throws(() => createNvidiaIntentExecutor(), /NVIDIA_API_KEY is required/);

let providerCalls = 0;
const executor = createNvidiaIntentExecutor({
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1'
});

assert.equal(typeof executor, 'function');

(async () => {
  const blocked = await executor({
    idea: 'Create a useful educational video',
    validate: async () => ({ status: 'PASS' })
  });
  assert.equal(blocked.status, 'BLOCK');
  assert.equal(providerCalls, 0);

  console.log('V2.4 NVIDIA INTENT execution wiring certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
