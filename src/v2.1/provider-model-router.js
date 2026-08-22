'use strict';

/**
 * Provider-neutral model/capability policy.
 *
 * Credentials are intentionally absent from this object: credentials belong
 * to a provider account/adapter, while models are configuration selected for
 * a capability. This lets the same provider credential serve many models and
 * lets a future provider be added without changing pipeline code.
 */
function createProviderModelRouter({ providers = {} } = {}) {
  const catalog = new Map();

  for (const [provider, capabilities] of Object.entries(providers)) {
    if (!capabilities || typeof capabilities !== 'object') throw new Error(`Invalid provider catalog: ${provider}`);
    const normalized = {};
    for (const [capability, config] of Object.entries(capabilities)) {
      const models = Array.isArray(config) ? config : config?.models;
      const defaultModel = Array.isArray(config) ? config[0] : config?.defaultModel;
      if (!Array.isArray(models) || models.length === 0 || models.some((model) => typeof model !== 'string' || !model)) {
        throw new Error(`Invalid model catalog: ${provider}:${capability}`);
      }
      if (!models.includes(defaultModel)) throw new Error(`Default model is not in catalog: ${provider}:${capability}`);
      normalized[capability] = Object.freeze({ models: Object.freeze([...new Set(models)]), defaultModel });
    }
    catalog.set(provider, Object.freeze(normalized));
  }

  function providersFor(capability) {
    return [...catalog.entries()]
      .filter(([, capabilities]) => Boolean(capabilities[capability]))
      .map(([provider]) => provider);
  }

  function resolve({ provider, capability, model = null } = {}) {
    if (!provider) throw new Error('PROVIDER_REQUIRED');
    if (!capability) throw new Error('CAPABILITY_REQUIRED');
    const capabilities = catalog.get(provider);
    if (!capabilities || !capabilities[capability]) throw new Error(`CAPABILITY_UNSUPPORTED:${provider}:${capability}`);
    const entry = capabilities[capability];
    const selectedModel = model || entry.defaultModel;
    if (!entry.models.includes(selectedModel)) throw new Error(`MODEL_UNSUPPORTED:${provider}:${capability}:${selectedModel}`);
    return Object.freeze({ provider, capability, model: selectedModel });
  }

  return Object.freeze({
    providersFor,
    resolve,
    catalog: Object.freeze(Object.fromEntries(
      [...catalog.entries()].map(([provider, capabilities]) => [provider, Object.freeze({ ...capabilities })]),
    )),
  });
}

module.exports = { createProviderModelRouter };
