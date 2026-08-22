'use strict';

const { CAPABILITIES, normalizeCapability } = require('./capability-contract');

class ProviderRegistry {
  constructor({ providers = {}, priorities = {}, routing = {} } = {}) {
    this.providers = new Map(Object.entries(providers));
    this.priorities = new Map(Object.entries(priorities));
    this.availability = new Map();
    this.routing = { strategy: routing.strategy || 'auto', fallbackOnError: routing.fallbackOnError !== false };
    this.cursors = new Map();
    for (const name of this.providers.keys()) this.availability.set(name, 'available');
  }

  register(name, adapter, { priority = 100, availability = 'available' } = {}) {
    if (!name || !adapter || typeof adapter.generate !== 'function') throw new Error('Provider adapter must expose generate()');
    this.providers.set(name, adapter);
    this.priorities.set(name, Number.isFinite(priority) ? priority : 100);
    this.availability.set(name, availability);
  }

  get(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider '${name}' is not registered`);
    return provider;
  }

  setAvailability(name, status) {
    if (!this.providers.has(name)) throw new Error(`Provider '${name}' is not registered`);
    if (!['available', 'unavailable', 'unknown'].includes(status)) throw new Error(`Invalid availability status '${status}'`);
    this.availability.set(name, status);
  }

  getAvailability(name) {
    if (!this.providers.has(name)) throw new Error(`Provider '${name}' is not registered`);
    return this.availability.get(name) || 'unknown';
  }

  getStatus() {
    return [...this.providers.keys()].map((provider) => ({ provider, status: this.getAvailability(provider) }));
  }

  async refreshAvailability() {
    await Promise.all([...this.providers.entries()].map(async ([name, adapter]) => {
      if (typeof adapter.healthCheck !== 'function') {
        this.availability.set(name, 'available');
        return;
      }
      try {
        this.availability.set(name, (await adapter.healthCheck()) ? 'available' : 'unavailable');
      } catch {
        this.availability.set(name, 'unavailable');
      }
    }));
    return this.getStatus();
  }

  candidates({ capability = CAPABILITIES.TEXT_GENERATION, model } = {}) {
    const canonicalCapability = normalizeCapability(capability);
    return [...this.providers.entries()]
      .filter(([name]) => this.getAvailability(name) === 'available')
      .filter(([, adapter]) => typeof adapter.supports !== 'function' || adapter.supports({ capability: canonicalCapability, model }))
      .map(([name, adapter]) => ({ provider: name, model: model || adapter.model || null, priority: this.priorities.get(name) ?? 100 }))
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));
  }

  select({ capability = CAPABILITIES.TEXT_GENERATION, provider, model, routeKey = capability } = {}) {
    const canonicalCapability = normalizeCapability(capability);
    if (provider) {
      const adapter = this.get(provider);
      if (this.getAvailability(provider) !== 'available') throw new Error(`Provider '${provider}' is not available`);
      if (typeof adapter.supports === 'function' && !adapter.supports({ capability: canonicalCapability, model })) throw new Error(`Provider '${provider}' does not support capability '${canonicalCapability}'`);
      return { provider, model: model || adapter.model || null, selectionReason: 'explicit-provider', capability: canonicalCapability };
    }
    const candidates = this.candidates({ capability: canonicalCapability, model });
    if (!candidates.length) throw new Error(`No available provider supports capability '${canonicalCapability}'`);
    if (candidates.length === 1) return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'single-available-provider', capability: canonicalCapability };
    if (this.routing.strategy === 'priority') return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'priority', capability: canonicalCapability };
    const cursor = this.cursors.get(routeKey) || 0;
    const selected = candidates[cursor % candidates.length];
    this.cursors.set(routeKey, (cursor + 1) % candidates.length);
    return { provider: selected.provider, model: selected.model, selectionReason: 'round-robin', capability: canonicalCapability };
  }

  getFallbacks({ capability = CAPABILITIES.TEXT_GENERATION, model, excludeProvider } = {}) {
    return this.candidates({ capability: normalizeCapability(capability), model }).filter(({ provider }) => provider !== excludeProvider);
  }
}

module.exports = { ProviderRegistry };
