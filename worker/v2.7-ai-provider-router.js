'use strict';

class AIProviderRouter {
  constructor(providers = {}) { this.providers = new Map(Object.entries(providers)); }
  register(name, provider) { if (!name || !provider || typeof provider.generate !== 'function') throw new TypeError('invalid provider'); this.providers.set(name, provider); }
  async generate(providerName, request) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`provider not registered: ${providerName}`);
    const response = await provider.generate(request);
    if (!response || typeof response.content !== 'string') throw new Error('provider returned invalid content');
    return { provider: providerName, model: response.model ?? request.model ?? 'unknown', content: response.content, usage: response.usage ?? {} };
  }
}

module.exports = { AIProviderRouter };
