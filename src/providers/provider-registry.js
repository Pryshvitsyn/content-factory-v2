'use strict';

const CAPABILITY_ALIASES = new Map([
  ['text-generation', 'text-generation'],
  ['text_generation', 'text-generation'],
  ['text generation', 'text-generation'],
  ['image-generation', 'image-generation'],
  ['image_generation', 'image-generation'],
  ['image generation', 'image-generation'],
  ['multi-view-identity-reference', 'multi-view-identity-reference'],
  ['multi_view_identity_reference', 'multi-view-identity-reference'],
  ['multi view identity reference', 'multi-view-identity-reference'],
  ['video-generation', 'video-generation'],
  ['video_generation', 'video-generation'],
  ['video generation', 'video-generation'],
  ['audio-generation', 'audio-generation'],
  ['audio_generation', 'audio-generation'],
  ['audio generation', 'audio-generation'],
  ['speech-generation', 'speech-generation'],
  ['speech_generation', 'speech-generation'],
  ['speech generation', 'speech-generation'],
]);

function normalizeCapability(capability = 'text-generation') {
  const value = String(capability).trim().toLowerCase();
  return CAPABILITY_ALIASES.get(value) || value.replace(/_/g, '-').replace(/\s+/g, '-');
}

class ProviderRegistry {
  constructor(options = {}) {
    const legacyProviders = Array.isArray(options) ? options : null;
    const { providers = {}, priorities = {}, routing = {} } = legacyProviders
      ? { providers: Object.fromEntries(legacyProviders.map((provider) => [provider.name || provider.provider, provider])) }
      : options;
    this.providers = new Map(Object.entries(providers));
    this.priorities = new Map(Object.entries(priorities).filter(([, value]) => Number.isFinite(value)));
    this.routePriorities = new Map(Object.entries(priorities).filter(([, value]) => Array.isArray(value)));
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
    if (adapter.models && typeof adapter.models === 'object') {
      const entry = Object.entries(adapter.models).find(([name]) => normalizeCapability(name) === normalizeCapability(capability));
      if (entry) return entry[1];
    }
    return adapter.model || null;
  }

  candidates({ capability = 'text-generation', model, routeKey } = {}) {
    const normalizedCapability = normalizeCapability(capability);
    const preferredProviders = this.routePriorities.get(routeKey) || this.routePriorities.get(normalizedCapability) || [];
    return [...this.providers.entries()]
      .filter(([name]) => this.getAvailability(name) === 'available')
      .filter(([, adapter]) => {
        if (typeof adapter.supports === 'function') return adapter.supports({ capability: normalizedCapability, model });
        if (Array.isArray(adapter.capabilities)) {
          return adapter.capabilities.some((value) => normalizeCapability(value) === normalizedCapability);
        }
        return true;
      })
      .map(([name, adapter]) => ({
        provider: name,
        model: this.resolveModel(adapter, { capability: normalizedCapability, model }),
        priority: this.priorities.get(name) ?? 100,
      }))
      .sort((a, b) => {
        const aRoutePriority = preferredProviders.includes(a.provider) ? preferredProviders.indexOf(a.provider) : Number.MAX_SAFE_INTEGER;
        const bRoutePriority = preferredProviders.includes(b.provider) ? preferredProviders.indexOf(b.provider) : Number.MAX_SAFE_INTEGER;
        return aRoutePriority - bRoutePriority || a.priority - b.priority || a.provider.localeCompare(b.provider);
      });
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
    const candidates = this.candidates({ capability: normalizedCapability, model, routeKey: effectiveRouteKey });
    if (!candidates.length) throw new Error(`No available provider supports capability '${normalizedCapability}'`);
    if (candidates.length === 1) return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'single-available-provider' };
    if (this.routePriorities.has(effectiveRouteKey) || this.routePriorities.has(normalizedCapability)) {
      return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'route-priority' };
    }
    if (this.routing.strategy === 'priority') return { provider: candidates[0].provider, model: candidates[0].model, selectionReason: 'priority' };
    const cursor = this.cursors.get(effectiveRouteKey) || 0;
    const selected = candidates[cursor % candidates.length];
    this.cursors.set(effectiveRouteKey, (cursor + 1) % candidates.length);
    return { provider: selected.provider, model: selected.model, selectionReason: 'round-robin' };
  }

  getFallbacks({ capability = 'text-generation', model, routeKey, excludeProvider } = {}) {
    return this.candidates({ capability, model, routeKey }).filter(({ provider }) => provider !== excludeProvider);
  }
}

module.exports = { ProviderRegistry, normalizeCapability };
