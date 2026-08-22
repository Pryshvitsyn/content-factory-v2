'use strict';

const assert = require('node:assert/strict');
const { createNvidiaAdapter } = require('../src/providers/nvidia-adapter');

async function main() {
  let request;
  const adapter = createNvidiaAdapter({
    apiKey: 'test-key',
    imageFetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'imgreq-1',
            model: 'black-forest-labs/flux.2-klein-4b',
            artifacts: [{ base64: Buffer.from('real-image-bytes').toString('base64'), mime_type: 'image/png' }],
          };
        },
      };
    },
  });

  assert.equal(adapter.provider, 'nvidia');
  assert.equal(adapter.supports({ capability: 'image-generation' }), true);

  const result = await adapter.generate({
    capability: 'image-generation',
    prompt: 'A cinematic sunrise over Rome',
    metadata: { productionId: 'prod-1', assetId: 'asset-1' },
    idempotencyKey: 'prod-1:media:asset-1',
    seed: 42,
  });

  assert.equal(request.url, 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers['Idempotency-Key'], 'prod-1:media:asset-1');

  const body = JSON.parse(request.options.body);
  assert.equal(body.prompt, 'A cinematic sunrise over Rome');
  assert.equal(body.mode, 'Image Generation');
  assert.equal(body.samples, 1);
  assert.equal(body.seed, 42);

  assert.ok(Buffer.isBuffer(result.output));
  assert.equal(result.output.toString(), 'real-image-bytes');
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.provider, 'nvidia');
  assert.equal(result.model, 'black-forest-labs/flux.2-klein-4b');
  assert.equal(result.requestId, 'imgreq-1');

  const emptyAdapter = createNvidiaAdapter({
    apiKey: 'test-key',
    imageFetch: async () => ({ ok: true, status: 200, async json() { return { artifacts: [] }; } }),
  });
  await assert.rejects(
    () => emptyAdapter.generate({ capability: 'image-generation', prompt: 'x' }),
    /NVIDIA image generation returned no image artifact/
  );

  console.log('v2.1 NVIDIA real image generation certification passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
