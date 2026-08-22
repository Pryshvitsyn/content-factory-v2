const assert = require('node:assert/strict');

const { ProviderRegistry } = require('../src/providers/provider-registry');
const { ProviderGateway } = require('../src/providers/provider-gateway');

function makeProvider(name, capabilities, model = `${name}/test`) {
  return {
    name,
    capabilities,
    models: capabilities.reduce((acc, capability) => ({ ...acc, [capability]: model }), {}),
    async generate() {
      return { provider: name, model };
    },
  };
}

async function run() {
  const providers = [
    makeProvider('nvidia', ['text_generation', 'image_generation', 'video_generation']),
    makeProvider('mock-specialist', ['audio_generation']),
  ];

  const registry = new ProviderRegistry(providers);
  const gateway = new ProviderGateway(registry);

  const matrix = {
    text_generation: 'nvidia',
    image_generation: 'nvidia',
    video_generation: 'nvidia',
    audio_generation: 'mock-specialist',
  };

  for (const [capability, expectedProvider] of Object.entries(matrix)) {
    const selected = gateway.select(capability);
    assert.equal(selected.provider, expectedProvider, `${capability} should route to ${expectedProvider}`);
    assert.equal(selected.capability, capability);
  }

  assert.throws(
    () => gateway.select('unknown_capability'),
    /No available provider supports capability/,
  );

  console.log('v2.1 provider capability matrix: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
