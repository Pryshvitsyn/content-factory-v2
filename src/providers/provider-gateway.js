'use strict';

const { ProviderRegistry } = require('./provider-registry');

class ProviderGateway {
  constructor({ providers, priorities } = {}) {
    this.registry = new ProviderRegistry({ providers, priorities });
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

  async generate({ capability = 'text-generation', provider, model, ...request } = {}) {
    const selection = this.select({ capability, provider, model });
    const adapter = this.get(selection.provider);
    const result = await adapter.generate({ ...request, model: selection.model });
    return {
      ...result,
      provenance: {
        ...(result.provenance || {}),
        provider: result.provider || selection.provider,
        model: result.model || selection.model,
        selectionReason: selection.selectionReason,
      },
    };
  }
}

module.exports = { ProviderGateway };
