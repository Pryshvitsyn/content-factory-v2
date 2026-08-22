'use strict';

const { createProviderModelRouter } = require('./provider-model-router');

/**
 * NVIDIA is the first provider, not the permanent architecture boundary.
 * These identifiers mirror NVIDIA's currently documented NIM model names.
 * Credentials are provider-level; models are capability-level configuration.
 */
const NVIDIA_MODEL_CATALOG = Object.freeze({
  text_generation: Object.freeze({
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    models: Object.freeze(['nvidia/nemotron-3-super-120b-a12b']),
  }),
  image_generation: Object.freeze({
    defaultModel: 'black-forest-labs/flux.2-klein-4b',
    models: Object.freeze([
      'black-forest-labs/flux.2-klein-4b',
      'qwen/qwen-image-2512',
      'black-forest-labs/flux.1-dev',
      'black-forest-labs/flux.1-schnell',
      'stabilityai/stable-diffusion-3.5-large',
    ]),
  }),
  image_editing: Object.freeze({
    defaultModel: 'black-forest-labs/flux.2-klein-4b',
    models: Object.freeze([
      'black-forest-labs/flux.2-klein-4b',
      'qwen/qwen-image-edit-2511',
    ]),
  }),
  video_generation: Object.freeze({
    defaultModel: 'wan-ai/wan2.2',
    models: Object.freeze(['wan-ai/wan2.2']),
  }),
});

const NVIDIA_ROUTER = createProviderModelRouter({ nvidia: NVIDIA_MODEL_CATALOG });
const DEFAULT_MODELS = Object.freeze(Object.fromEntries(
  Object.entries(NVIDIA_MODEL_CATALOG).map(([capability, config]) => [capability, config.defaultModel]),
));

function createNvidiaModelCapabilityRouter({ models = {} } = {}) {
  const catalog = Object.fromEntries(Object.entries(NVIDIA_MODEL_CATALOG).map(([capability, config]) => [
    capability,
    { defaultModel: models[capability] || config.defaultModel, models: config.models },
  ]));
  return createProviderModelRouter({ nvidia: catalog });
}

module.exports = {
  createNvidiaModelCapabilityRouter,
  DEFAULT_MODELS,
  NVIDIA_MODEL_CATALOG,
  NVIDIA_ROUTER,
};
