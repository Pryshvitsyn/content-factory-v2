'use strict';

const assert = require('node:assert/strict');
const { createProviderAdapter } = require('../src/v2.1/provider-adapter');

async function run() {
  const calls = [];
  let credentialCalls = 0;
  const adapter = createProviderAdapter({
    provider: 'test-provider',
    accountId: 'brand-main',
    capabilities: ['PUBLISH', 'IDEMPOTENCY', 'RECONCILE'],
    credentialProvider: async ({ provider, accountId }) => {
      credentialCalls += 1;
      return { provider, accountId, secret: 'opaque-to-domain' };
    },
    publish: async (request) => {
      calls.push(request);
      return { delivery: 'ACCEPTED', providerRequestId: 'req-1' };
    },
    reconcile: async (request) => ({ delivery: 'CONFIRMED', externalId: request.idempotencyKey }),
  });

  const result = await adapter.publish({
    artifactVersionId: 'av-1',
    destination: 'channel-1',
    idempotencyKey: 'pub-1',
  });

  assert.equal(result.delivery, 'ACCEPTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, 'pub-1');
  assert.equal(calls[0].credentials.secret, 'opaque-to-domain');
  assert.equal(credentialCalls, 1);

  const reconciliation = await adapter.reconcile({ idempotencyKey: 'pub-1' });
  assert.equal(reconciliation.delivery, 'CONFIRMED');

  assert.throws(() => createProviderAdapter({
    provider: 'broken', accountId: 'a', capabilities: ['RECONCILE'],
    credentialProvider: async () => ({}), publish: async () => ({}),
  }), /reconcile function is required/);

  console.log('V2.1 provider adapter certification: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
