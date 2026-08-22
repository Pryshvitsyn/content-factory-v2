'use strict';

const assert = require('node:assert/strict');
const { ProviderGateway } = require('../src/providers/provider-gateway');

function provider() {
  return {
    model: 'nvidia/test',
    supports({ capability }) { return capability === 'text-generation'; },
    async generate() { return { provider: 'nvidia', model: 'nvidia/test', output: 'ok' }; },
  };
}

async function run() {
  const gateway = new ProviderGateway({ providers: { nvidia: provider() } });
  for (const capability of ['text-generation', 'text_generation', 'text generation']) {
    const selection = gateway.select({ capability });
    assert.equal(selection.provider, 'nvidia');
    assert.equal(selection.model, 'nvidia/test');
  }
  console.log('V2.1 provider capability aliases: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
