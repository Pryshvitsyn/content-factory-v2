'use strict';

const assert = require('node:assert/strict');
const { ProviderGateway } = require('../src/providers/provider-gateway');

function provider(name, model, { fail = false } = {}) {
  return {
    provider: name,
    model,
    supports({ capability }) { return capability === 'text_generation'; },
    async generate({ prompt }) {
      if (fail) throw new Error(`${name} unavailable`);
      return { provider: name, model, output: `${name}:${prompt}` };
    },
  };
}

async function run() {
  const single = new ProviderGateway({ providers: { nvidia: provider('nvidia', 'nvidia/test') } });
  const singleSelection = single.select({ capability: 'text_generation' });
  assert.equal(singleSelection.provider, 'nvidia');
  assert.equal(singleSelection.selectionReason, 'single-available-provider');

  const singleResult = await single.generate({ capability: 'text_generation', prompt: 'one' });
  assert.equal(singleResult.provider, 'nvidia');
  assert.deepEqual(singleResult.provenance.attemptedProviders, ['nvidia']);

  const multi = new ProviderGateway({
    providers: {
      nvidia: provider('nvidia', 'nvidia/test'),
      openai: provider('openai', 'openai/test'),
    },
    priorities: { nvidia: 10, openai: 20 },
  });

  const first = multi.select({ capability: 'text_generation', routeKey: 'creative' });
  const second = multi.select({ capability: 'text_generation', routeKey: 'creative' });
  assert.notEqual(first.provider, second.provider);
  assert.equal(first.selectionReason, 'round-robin');
  assert.equal(second.selectionReason, 'round-robin');

  const failover = new ProviderGateway({
    providers: {
      nvidia: provider('nvidia', 'nvidia/test', { fail: true }),
      openai: provider('openai', 'openai/test'),
    },
    priorities: { nvidia: 10, openai: 20 },
    routing: { strategy: 'priority', fallbackOnError: true },
  });
  const recovered = await failover.generate({ capability: 'text_generation', prompt: 'recover', routeKey: 'recovery' });
  assert.equal(recovered.provider, 'openai');
  assert.equal(recovered.provenance.selectionReason, 'fallback');
  assert.deepEqual(recovered.provenance.attemptedProviders, ['nvidia', 'openai']);

  console.log('V2.1 provider routing: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
