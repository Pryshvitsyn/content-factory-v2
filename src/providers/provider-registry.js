'use strict';

class ProviderRegistry {
  constructor({ providers = {}, priorities = {} } = {}) {
    this.providers = new Map(Object.entries(providers));
    this.priorities = new Map(Object.entries(priorities));
  }

  register(name, adapter, { priority = 100 } = {}) {
    if (!name || !adapter || typeof adapter.generate !== 'function') {
      throw new Error('Provider adapter must expose generate()');
    }
    this.providers.set(name, adapter);
    this.priorities.set(name, Number.isFinite(priority) ? priority : 100);
  }

  get(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider '${name}' is not registered`);
    return provider;
  }

  select({ capability = 'text-generation', provider, model } = {}) {
    if (provider) {
      const adapter = this.get(provider);
      if (typeof adapter.supports === 'function' && !adapter.supports({ capability, model })) {
        throw new Error(`Provider '${provider}' does not support capability '${capability}'`);
      }
      return { provider, model: model || adapter.model || null, selectionReason: 'explicit-provider' };
    }

    const candidates = [...this.providers.entries()]
      .filter(([, adapter]) => typeof adapter.supports !== 'function' || adapter.supports({ capability, model }))
      .map(([name, adapter]) => ({
        provider: name,
        model: model || adapter.model || null,
        priority: this.priorities.get(name) ?? 100,
      }))
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));

    if (!candidates.length) throw new Error(`No enabled provider supports capability '${capability}'`);
    const selected = candidates[0];
    return { provider: selected.provider, model: selected.model, selectionReason: 'priority' };
  }
}

module.exports = { ProviderRegistry };
