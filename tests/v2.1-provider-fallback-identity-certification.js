'use strict';

const assert = require('node:assert/strict');
const { ProviderGateway } = require('../src/providers/provider-gateway');

async function run() {
  const calls = [];
  const idempotencyKey = 'cert-fallback-job-stage-output-v1';

  const primary = {
    model: 'primary/test-model',
    async generate({ idempotencyKey: key }) {
      calls.push({ provider: 'primary', idempotencyKey: key });
      const error = new Error('simulated upstream timeout');
      error.code = 'UPSTREAM_TIMEOUT';
      throw error;
    },
  };

  const fallback = {
    model: 'fallback/test-model',
    async generate({ idempotencyKey: key }) {
      calls.push({ provider: 'fallback', idempotencyKey: key });
      return {
        provider: 'fallback',
        model: 'fallback/test-model',
        output: 'recovered-output',
        requestId: 'fallback-request-1',
      };
    },
  };

  const gateway = new ProviderGateway({
    providers: { primary, fallback },
    priorities: { primary: 10, fallback: 20 },
    routing: { strategy: 'priority', fallbackOnError: true },
  });

  const result = await gateway.generate({
    capability: 'text-generation',
    routeKey: 'cert-fallback',
    idempotencyKey,
    prompt: 'certification prompt',
  });

  assert.equal(result.output, 'recovered-output');
  assert.deepEqual(calls, [
    { provider: 'primary', idempotencyKey },
    { provider: 'fallback', idempotencyKey },
  ]);
  assert.deepEqual(result.provenance.attemptedProviders, ['primary', 'fallback']);
  assert.equal(result.provenance.selectionReason, 'fallback');
  assert.equal(result.provenance.idempotencyKey, idempotencyKey);

  console.log('V2.1 provider fallback identity certification: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
