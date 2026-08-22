'use strict';

const assert = require('node:assert/strict');
const { createNvidiaModelCapabilityRouter, DEFAULT_MODELS } = require('../src/v2.1/nvidia-model-capability-router');

function main() {
  const router = createNvidiaModelCapabilityRouter();

  assert.equal(router.provider, 'nvidia');
  assert.deepEqual(router.resolve('text_generation'), {
    provider: 'nvidia',
    capability: 'text_generation',
    model: DEFAULT_MODELS.text_generation,
  });
  assert.deepEqual(router.resolve('image_generation'), {
    provider: 'nvidia',
    capability: 'image_generation',
    model: DEFAULT_MODELS.image_generation,
  });

  const custom = createNvidiaModelCapabilityRouter({
    models: { image_generation: 'qwen-image-2512' },
  });
  assert.equal(custom.resolve('image_generation').model, 'qwen-image-2512');
  assert.equal(custom.resolve('image_editing').model, DEFAULT_MODELS.image_editing);

  assert.throws(() => router.resolve('video_generation'), /NVIDIA_CAPABILITY_UNSUPPORTED/);
  assert.throws(() => createNvidiaModelCapabilityRouter({ provider: 'openai' }), /NVIDIA_ROUTER_PROVIDER_REQUIRED/);

  console.log('v2.1 NVIDIA model capability routing certification passed');
}

main();
