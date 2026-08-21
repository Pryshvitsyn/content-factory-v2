'use strict';

const assert = require('node:assert/strict');
const { ProviderGateway } = require('../src/providers/provider-gateway');

async function run() {
  const seen = [];
  const gateway = new ProviderGateway({
    providers: {
      primary: {
        async generate(request) {
          seen.push({ provider: 'primary', ...request });
          throw new Error('primary unavailable');
        },
      },
      backup: {
        async generate(request) {
          seen.push({ provider: 'backup', ...request });
          return {
            provider: 'backup',
            model: request.model || 'backup-model',
            output: 'stable',
            requestId: 'req-1',
          };
        },
      },
    },
    priorities: { text: ['primary', 'backup'] },
    routing: { fallbackOnError: true },
  });

  const key = 'job-123:stage-1:artifact-1';
  const result = await gateway.generate({
    capability: 'text-generation',
    routeKey: 'text',
    idempotencyKey: key,
    prompt: 'test',
  });

  assert.equal(result.provider, 'backup');
  assert.equal(result.provenance.idempotencyKey, key);
  assert.deepEqual(seen.map(({ provider, idempotencyKey }) => ({ provider, idempotencyKey })), [
    { provider: 'primary', idempotencyKey: key },
    { provider: 'backup', idempotencyKey: key },
  ]);

  console.log('V2.1 provider idempotency routing propagation: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
