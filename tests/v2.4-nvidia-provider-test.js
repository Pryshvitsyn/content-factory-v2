'use strict';

const assert = require('node:assert/strict');
const { NvidiaProvider } = require('../worker/v2.4-nvidia-provider');

assert.throws(() => new NvidiaProvider(), /NVIDIA_API_KEY is required/);

const provider = new NvidiaProvider({ apiKey: 'test-key' });
assert.equal(typeof provider.generateStage, 'function');

console.log('V2.4 NVIDIA provider adapter certification: PASS');
