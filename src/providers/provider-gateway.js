'use strict';

const { ProviderRegistry, normalizeCapability } = require('./provider-registry');

class ProviderGateway {
  constructor(options = {}) {
    this.registry = options instanceof ProviderRegistry ? options : new ProviderRegistry(options);
  }

  register(name, adapter, options) {
    this.registry.register(name, adapter, options);
  }

  get(name) {
    return this.registry.get(name);
  }

  select(options) {
    if (typeof options === 'string') return { ...this.registry.select({ capability: options }), capability: options };
    return this.registry.select(options);
  }

  async generate({ capability = 'text-generation', provider, model, routeKey = capability, idempotencyKey, ...request } = {}) {
    const normalizedCapability = normalizeCapability(capability);
    const selection = this.select({ capability: normalizedCapability, provider, model, routeKey });
    const attempts = [selection, ...this.registry.getFallbacks({ capability: normalizedCapability, model, routeKey, excludeProvider: selection.provider })];
    let lastError;

    for (let index = 0; index < attempts.length; index += 1) {
      const current = attempts[index];
      const adapter = this.get(current.provider);
      try {
        const result = await adapter.generate({
          ...request,
          capability: normalizedCapability,
          model: current.model,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return {
          ...result,
          provenance: {
            ...(result.provenance || {}),
            provider: result.provider || current.provider,
            model: result.model || current.model,
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

    throw lastError || new Error(`No provider could generate capability '${capability}'`);
  }

  async recover({ capability = 'text-generation', provider, model, requestId, ...request } = {}) {
    if (!provider) throw new Error('provider is required for recovery');
    if (!requestId) throw new Error('requestId is required for recovery');
    const normalizedCapability = normalizeCapability(capability);
    const adapter = this.get(provider);
    if (typeof adapter.recover !== 'function') {
      const error = new Error(`Provider '${provider}' does not support request recovery`);
      error.code = 'PROVIDER_RECOVERY_UNSUPPORTED';
      throw error;
    }
    const result = await adapter.recover({ capability: normalizedCapability, model, requestId, ...request });
    return {
      ...result,
      provenance: {
        ...(result.provenance || {}), provider: result.provider || provider,
        model: result.model || model || null, recovery: true,
      },
    };
  }
}

module.exports = { ProviderGateway };
