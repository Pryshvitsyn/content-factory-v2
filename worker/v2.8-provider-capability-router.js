'use strict';

class CapabilityRouter {
  constructor(providers = {}) { this.providers = new Map(Object.entries(providers)); }
  register(name, provider) { if (!name || !provider || typeof provider.generate !== 'function') throw new TypeError('invalid provider'); this.providers.set(name, provider); }
  async generate({ provider, capability, request, timeoutMs = 30000, maxRetries = 1 } = {}) {
    const candidates = provider ? [provider] : [...this.providers.keys()];
    let lastError;
    for (const name of candidates) {
      const p = this.providers.get(name);
      if (!p || (capability && !p.capabilities?.includes(capability))) continue;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await Promise.race([
            p.generate(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`provider timeout: ${name}`)), timeoutMs))
          ]);
          if (!result || typeof result.content !== 'string') throw new Error(`invalid provider response: ${name}`);
          return { provider: name, model: result.model ?? request?.model ?? 'unknown', content: result.content, usage: result.usage ?? {}, attempts: attempt + 1 };
        } catch (err) { lastError = err; }
      }
    }
    throw lastError ?? new Error('no capable provider available');
  }
}

module.exports = { CapabilityRouter };
