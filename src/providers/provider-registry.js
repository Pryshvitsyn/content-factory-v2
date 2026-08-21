'use strict';

class ProviderRegistry {
  constructor({ providers = {}, priorities = {}, routing = {} } = {}) {
    this.providers = new Map(Object.entries(providers));
    this.priorities = new Map(Object.entries(priorities));
    this.routing = {
      strategy: routing.strategy || 'auto',
      fallbackOnError: routing.fallbackOnError !== false,
    };
    this.cursors = new Map();
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

  candidates({ capability = 'text-generation', model } = {}) {
    return [...this.providers.entries()]
      .filter(([, adapter]) => typeof adapter.supports !== 'function' || adapter.supports({ capability, model }))
      .map(([name, adapter]) => ({
        provider: name,
        model: model || adapter.model || null,
        priority: this.priorities.get(name) ?? 100,
      }))
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));
  }

  select({ capability = 'text-generation', provider, model, routeKey = capability } = {}) {
    if (provider) {
      const adapter = this.get(provider);
      if (typeof adapter.supports === 'function' && !adapter.supports({ capability, model })) {
        throw new Error(`Provider '${provider}' does not support capability '${capability}'`);
      }
      return { provider, model: model || adapter.model || null, selectionReason: 'explicit-provider' };
    }

    const candidates = this.candidates({ capability, model });
    if (!candidates.length) throw new Error(`No enabled provider supports capability '${capability}'`);
    if (candidates.length === 1) {
      const selected = candidates[0];
      return { provider: selected.provider, model: selected.model, selectionReason: 'single-available-provider' };
    }

    if (this.routing.strategy === 'priority') {
      const selected = candidates[0];
      return { provider: selected.provider, model: selected.model, selectionReason: 'priority' };
    }

    const cursor = this.cursors.get(routeKey) || 0;
    const selected = candidates[cursor % candidates.length];
    this.cursors.set(routeKey, (cursor + 1) % candidates.length);
    return { provider: selected.provider, model: selected.model, selectionReason: 'round-robin' };
  }

  getFallbacks({ capability = 'text-generation', model, excludeProvider } = {}) {
    return this.candidates({ capability, model }).filter(({ provider }) => provider !== excludeProvider);
  }
}

module.exports = { ProviderRegistry };
