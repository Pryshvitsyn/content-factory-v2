'use strict';

class ProviderGateway {
  constructor({ providers }) {
    this.providers = new Map(Object.entries(providers || {}));
  }

  register(name, adapter) {
    if (!name || !adapter || typeof adapter.generate !== 'function') {
      throw new Error('Provider adapter must expose generate()');
    }
    this.providers.set(name, adapter);
  }

  get(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider '${name}' is not registered`);
    return provider;
  }

  async generate({ provider = 'nvidia', ...request }) {
    return this.get(provider).generate(request);
  }
}

module.exports = { ProviderGateway };
