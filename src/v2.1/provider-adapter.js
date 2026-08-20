'use strict';

const PROVIDER_CAPABILITIES = Object.freeze([
  'PUBLISH', 'IDEMPOTENCY', 'RECONCILE', 'SCHEDULE', 'UPDATE', 'DELETE',
]);

const DELIVERY_RESULTS = Object.freeze(['ACCEPTED', 'CONFIRMED', 'UNKNOWN', 'REJECTED']);

function assertCapabilities(capabilities = []) {
  for (const capability of capabilities) {
    if (!PROVIDER_CAPABILITIES.includes(capability)) {
      throw new Error(`Unsupported provider capability: ${capability}`);
    }
  }
}

function createProviderAdapter({ provider, accountId, capabilities = [], credentialProvider, publish, reconcile }) {
  if (!provider) throw new Error('provider is required');
  if (!accountId) throw new Error('accountId is required');
  assertCapabilities(capabilities);
  if (typeof credentialProvider !== 'function') throw new Error('credentialProvider is required');
  if (typeof publish !== 'function') throw new Error('publish function is required');
  if (capabilities.includes('RECONCILE') && typeof reconcile !== 'function') {
    throw new Error('reconcile function is required when RECONCILE is supported');
  }

  return Object.freeze({
    provider,
    accountId,
    capabilities: Object.freeze([...new Set(capabilities)]),
    async publish(request) {
      if (!request || !request.idempotencyKey) throw new Error('idempotencyKey is required');
      const credentials = await credentialProvider({ provider, accountId });
      return publish({ ...request, credentials });
    },
    async reconcile(request) {
      if (!capabilities.includes('RECONCILE')) throw new Error('RECONCILE capability is not supported');
      const credentials = await credentialProvider({ provider, accountId });
      return reconcile({ ...request, credentials });
    },
  });
}

module.exports = { PROVIDER_CAPABILITIES, DELIVERY_RESULTS, assertCapabilities, createProviderAdapter };
