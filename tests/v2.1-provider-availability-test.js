'use strict';

const assert = require('node:assert/strict');
const { ProviderGateway } = require('../src/providers/provider-gateway');

function provider(name, healthy = true) {
  return {
    provider: name,
    model: `${name}/test`,
    supports({ capability }) { return capability === 'text_generation'; },
    async healthCheck() { return healthy; },
    async generate({ prompt }) { return { provider: name, model: `${name}/test`, output: `${name}:${prompt}` }; },
  };
}

async function run() {
  const single = new ProviderGateway({ providers: { nvidia: provider('nvidia') } });
  assert.deepEqual(await single.registry.refreshAvailability(), [{ provider: 'nvidia', status: 'available' }]);
  assert.deepEqual(single.select({ capability: 'text_generation' }), {
    provider: 'nvidia', model: 'nvidia/test', capability: 'text_generation', selectionReason: 'single-available-provider',
  });

  const mixed = new ProviderGateway({ providers: { nvidia: provider('nvidia'), openai: provider('openai', false) } });
  assert.deepEqual(await mixed.registry.refreshAvailability(), [
    { provider: 'nvidia', status: 'available' },
    { provider: 'openai', status: 'unavailable' },
  ]);
  assert.equal(mixed.select({ capability: 'text_generation' }).provider, 'nvidia');

  mixed.registry.setAvailability('nvidia', 'unavailable');
  assert.throws(() => mixed.select({ capability: 'text_generation' }), /No available provider/);

  mixed.registry.setAvailability('openai', 'available');
  assert.equal(mixed.select({ capability: 'text_generation' }).provider, 'openai');

  const explicit = new ProviderGateway({ providers: { nvidia: provider('nvidia', false), openai: provider('openai') } });
  await explicit.registry.refreshAvailability();
  assert.throws(() => explicit.select({ provider: 'nvidia' }), /not available/);
  assert.equal(explicit.select({ provider: 'openai' }).provider, 'openai');

  console.log('V2.1 provider availability: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
