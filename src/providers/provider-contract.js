'use strict';

class ProviderError extends Error {
  constructor(message, { provider, model, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = model;
    this.cause = cause;
  }
}

function assertProviderResult(result) {
  if (!result || typeof result !== 'object') {
    throw new ProviderError('Provider returned no result');
  }
  if (!result.provider || !result.model || typeof result.output !== 'string') {
    throw new ProviderError('Provider result violates normalized contract', {
      provider: result.provider,
      model: result.model,
    });
  }
  return Object.freeze({
    provider: result.provider,
    model: result.model,
    output: result.output,
    requestId: result.requestId || null,
    usage: result.usage || null,
    raw: result.raw || null,
  });
}

module.exports = { ProviderError, assertProviderResult };
