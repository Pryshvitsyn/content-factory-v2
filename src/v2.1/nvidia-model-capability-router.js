'use strict';

/**
 * NVIDIA-first capability routing.
 *
 * Credentials belong to the provider, not to individual models. Models are
 * selectable capabilities within the provider and can be changed without
 * changing secrets.
 */

const DEFAULT_MODELS = Object.freeze({
  text_generation: 'nvidia/nemotron-3-super-120b-a12b',
  image_generation: 'flux.2-klein-4b',
  image_editing: 'flux.2-klein-4b',
});

function createNvidiaModelCapabilityRouter({ models = {}, provider = 'nvidia' } = {}) {
  if (provider !== 'nvidia') throw new Error('NVIDIA_ROUTER_PROVIDER_REQUIRED');

  const resolved = { ...DEFAULT_MODELS, ...models };

  function resolve(capability, requestedModel = null) {
    if (!Object.prototype.hasOwnProperty.call(resolved, capability)) {
      throw new Error(`NVIDIA_CAPABILITY_UNSUPPORTED:${capability}`);
    }

    const model = requestedModel || resolved[capability];
    if (!model || typeof model !== 'string') {
      throw new Error(`NVIDIA_MODEL_UNAVAILABLE:${capability}`);
    }

    return Object.freeze({ provider, capability, model });
  }

  return Object.freeze({
    provider,
    resolve,
    models: Object.freeze({ ...resolved }),
  });
}

module.exports = { createNvidiaModelCapabilityRouter, DEFAULT_MODELS };
