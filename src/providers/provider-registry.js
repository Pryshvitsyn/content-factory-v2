'use strict';

const CAPABILITY_ALIASES = new Map([
  ['text-generation', 'text-generation'],
  ['text_generation', 'text-generation'],
  ['text generation', 'text-generation'],
  ['image-generation', 'image-generation'],
  ['image_generation', 'image-generation'],
  ['image generation', 'image-generation'],
  ['video-generation', 'video-generation'],
  ['video_generation', 'video-generation'],
  ['video generation', 'video-generation'],
  ['audio-generation', 'audio-generation'],
  ['audio_generation', 'audio-generation'],
  ['audio generation', 'audio-generation'],
]);

function normalizeCapability(capability = 'text-generation') {
  const value = String(capability).trim().toLowerCase();
  return CAPABILITY_ALIASES.get(value) || value.replace(/_/g, '-').replace(/\s+/g, '-');
}

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

  resolveModel(adapter, { capability, model } = {}) {
    if (model) return model;
    if (typeof adapter.modelFor === 'function') return adapter.modelFor({ capability });
    return adapter.model || null;
  }

  candidates({ capability = 'text-generation', model } = {}) {
    const normalizedCapability = normalizeCapability(capability);
    return [...this.providers.entries()]
      .filter(([name]) => this.getAvailability(name) === 'available')
      .filter(([, adapter]) => typeof adapter.supports !== 'function' || adapter.supports({ capability: normalizedCapability, model }))
      .map(([name, adapter]) => ({
        provider: name,
        model: this.resolveModel(adapter, { capability: normalizedCapability, model }),
        priority: this.priorities.get(name) ?? 100,
      }))
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));
  }

  select({ capability = 'text-generation', provider, model, routeKey } = {}) {
    const normalizedCapability = normalizeCapability(capability);
    const effectiveRouteKey = routeKey || normalizedCapability;
    if (provider) {
      const adapter = this.get(provider);
      if (this.getAvailability(provider) !== 'available') throw new Error(`Provider '${provider}' is not available`);
      if (typeof adapter.supports === 'function' && !adapter.supports({ capability: normalizedCapability, model })) throw new Error(`Provider '${provider}' does not support capability '${normalizedCapability}'`);
      return { provider, model: this.resolveModel(adapter, { capability: normalizedCapability, model }), selectionReason: 'explicit-provider' };
    }
    const candidates = this.candidates({ capability: normalizedCapability, model });
    if (!candidates.length) throw new Error(`No available provider supports capability '${normalizedCapability}'`);
    if (candidates.length === 1) return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'single-available-provider' };
    if (this.routing.strategy === 'priority') return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'priority' };
    const cursor = this.cursors.get(effectiveRouteKey) || 0;
    const selected = candidates[cursor % candidates.length];
    this.cursors.set(effectiveRouteKey, (cursor + 1) % candidates.length);
    return { provider: selected.provider, model: selected.model, selectionReason: 'round-robin' };
  }

  getFallbacks({ capability = 'text-generation', model, excludeProvider } = {}) {
    return this.candidates({ capability, model }).filter(({ provider }) => provider !== excludeProvider);
  }
}

module.exports = { ProviderRegistry, normalizeCapability };
