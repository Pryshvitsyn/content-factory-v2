'use strict';

const { ProviderRegistry } = require('./provider-registry');

class ProviderGateway {
  constructor({ providers, priorities, routing } = {}) {
    this.registry = new ProviderRegistry({ providers, priorities, routing });
  }

  register(name, adapter, options) {
    this.registry.register(name, adapter, options);
  }

  get(name) {
    return this.registry.get(name);
  }

  select(options) {
    return this.registry.select(options);
  }

  async generate({ capability = 'text-generation', provider, model, routeKey = capability, ...request } = {}) {
    const selection = this.select({ capability, provider, model, routeKey });
    const attempts = [selection, ...this.registry.getFallbacks({ capability, model, excludeProvider: selection.provider })];
    let lastError;

    for (let index = 0; index < attempts.length; index += 1) {
      const current = attempts[index];
      const adapter = this.get(current.provider);
      try {
        const result = await adapter.generate({ ...request, model: current.model });
        return {
          ...result,
          provenance: {
            ...(result.provenance || {}),
            provider: result.provider || current.provider,
            model: result.model || current.model,
            selectionReason: index === 0 ? current.selectionReason : 'fallback',
            attemptedProviders: attempts.slice(0, index + 1).map(({ provider: name }) => name),
          },
        };
      } catch (error) {
        lastError = error;
        if (provider || !this.registry.routing.fallbackOnError) throw error;
      }
    }

    throw lastError || new Error(`No provider could generate capability '${capability}'`);
  }
}

module.exports = { ProviderGateway };
