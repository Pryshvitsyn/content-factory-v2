'use strict';

const { ProviderRegistry } = require('./provider-registry');
const { CAPABILITIES, normalizeCapability } = require('./capability-contract');

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

  async generate({ capability = CAPABILITIES.TEXT_GENERATION, provider, model, routeKey, idempotencyKey, ...request } = {}) {
    const canonicalCapability = normalizeCapability(capability);
    const selection = this.select({ capability: canonicalCapability, provider, model, routeKey: routeKey || canonicalCapability });
    const attempts = [selection, ...this.registry.getFallbacks({ capability: canonicalCapability, model, excludeProvider: selection.provider })];
    let lastError;

    for (let index = 0; index < attempts.length; index += 1) {
      const current = attempts[index];
      const adapter = this.get(current.provider);
      try {
        const result = await adapter.generate({
          ...request,
          capability: canonicalCapability,
          model: current.model,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return {
          ...result,
          provenance: {
            ...(result.provenance || {}),
            provider: result.provider || current.provider,
            model: result.model || current.model,
            capability: result.provenance?.capability || canonicalCapability,
            selectionReason: index === 0 ? current.selectionReason : 'fallback',
            attemptedProviders: attempts.slice(0, index + 1).map(({ provider: name }) => name),
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        };
      } catch (error) {
        lastError = error;
        if (provider || !this.registry.routing.fallbackOnError) throw error;
      }
    }

    throw lastError || new Error(`No provider could generate capability '${canonicalCapability}'`);
  }
}

module.exports = { ProviderGateway };
