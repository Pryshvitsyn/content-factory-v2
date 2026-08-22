'use strict';

const assert = require('node:assert/strict');
const {
  createNvidiaModelCapabilityRouter,
  DEFAULT_MODELS,
  NVIDIA_MODEL_CATALOG,
} = require('../src/v2.1/nvidia-model-capability-router');
const { createProviderModelRouter } = require('../src/v2.1/provider-model-router');

function main() {
  const router = createNvidiaModelCapabilityRouter();

  assert.deepEqual(router.resolve({ provider: 'nvidia', capability: 'text_generation' }), {
    provider: 'nvidia', capability: 'text_generation', model: DEFAULT_MODELS.text_generation,
  });
  assert.deepEqual(router.resolve({ provider: 'nvidia', capability: 'image_generation' }), {
    provider: 'nvidia', capability: 'image_generation', model: DEFAULT_MODELS.image_generation,
  });
  assert.equal(router.resolve({ provider: 'nvidia', capability: 'video_generation' }).model, DEFAULT_MODELS.video_generation);

  const custom = createNvidiaModelCapabilityRouter({
    models: { image_generation: 'qwen/qwen-image-2512' },
  });
  assert.equal(custom.resolve({ provider: 'nvidia', capability: 'image_generation' }).model, 'qwen/qwen-image-2512');
  assert.equal(custom.resolve({ provider: 'nvidia', capability: 'image_editing' }).model, DEFAULT_MODELS.image_editing);

  assert.deepEqual(router.providersFor('image_generation'), ['nvidia']);
  assert.throws(() => router.resolve({ provider: 'nvidia', capability: 'image_generation', model: 'not-a-real-catalog-model' }), /MODEL_UNSUPPORTED/);
  assert.throws(() => router.resolve({ provider: 'openai', capability: 'image_generation' }), /CAPABILITY_UNSUPPORTED/);

  const future = createProviderModelRouter({
    nvidia: NVIDIA_MODEL_CATALOG,
    openai: {
      image_generation: { defaultModel: 'future-image', models: ['future-image', 'future-image-fast'] },
      video_generation: { defaultModel: 'future-video', models: ['future-video'] },
    },
  });
  assert.deepEqual(future.providersFor('video_generation'), ['nvidia', 'openai']);
  assert.equal(future.resolve({ provider: 'openai', capability: 'image_generation' }).model, 'future-image');
  assert.equal(future.resolve({ provider: 'openai', capability: 'image_generation', model: 'future-image-fast' }).model, 'future-image-fast');

  console.log('v2.1 provider-neutral model capability routing certification passed');
}

main();
