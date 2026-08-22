'use strict';

const assert = require('node:assert/strict');
const { createDefaultProviderGateway } = require('../src/providers/default-provider-gateway');

function fakeTextAdapter() {
  return {
    provider: 'nvidia',
    model: 'nvidia/test-text',
    supports({ capability, model }) {
      return capability === 'text-generation' && (!model || model === 'nvidia/test-text');
    },
    async generate({ prompt }) {
      return { provider: 'nvidia', model: 'nvidia/test-text', output: `text:${prompt}` };
    },
  };
}

function fakeVideoAdapter() {
  return {
    provider: 'nvidia',
    model: 'wan-ai/wan2.2',
    supports({ capability, model }) {
      return capability === 'video-generation' && (!model || model === 'wan-ai/wan2.2');
    },
    async generate({ prompt }) {
      return { provider: 'nvidia', model: 'wan-ai/wan2.2', output: 'video', raw: { mediaType: 'video/mp4' }, prompt };
    },
  };
}

async function run() {
  const gateway = createDefaultProviderGateway({
    nvidia: {
      textAdapter: fakeTextAdapter(),
      videoAdapter: fakeVideoAdapter(),
    },
  });

  assert.equal(gateway.select({ capability: 'text-generation' }).provider, 'nvidia');
  assert.equal(gateway.select({ capability: 'video-generation' }).provider, 'nvidia');
  assert.equal(gateway.select({ capability: 'video-generation', model: 'wan-ai/wan2.2' }).model, 'wan-ai/wan2.2');

  const text = await gateway.generate({ capability: 'text-generation', prompt: 'hello' });
  assert.equal(text.output, 'text:hello');
  assert.deepEqual(text.provenance.attemptedProviders, ['nvidia']);

  const video = await gateway.generate({ capability: 'video-generation', prompt: 'sunrise' });
  assert.equal(video.provider, 'nvidia');
  assert.equal(video.model, 'wan-ai/wan2.2');
  assert.equal(video.raw.mediaType, 'video/mp4');

  await assert.rejects(
    gateway.generate({ capability: 'audio-generation', prompt: 'nope' }),
    /No available provider supports capability 'audio-generation'/,
  );

  console.log('V2.1 provider composition: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
