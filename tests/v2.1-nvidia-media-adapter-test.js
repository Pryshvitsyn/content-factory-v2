'use strict';

const assert = require('node:assert/strict');
const { createNvidiaMediaAdapter, DEFAULT_IMAGE_MODEL } = require('../src/providers/nvidia-media-adapter');
const { CAPABILITIES } = require('../src/providers/capability-contract');

async function main() {
  const imageBytes = Buffer.from('real-image-bytes-for-contract-test');
  let received;
  const client = {
    images: {
      async generate(request, options) {
        received = { request, options };
        return { id: 'nvidia-image-test-1', data: [{ b64_json: imageBytes.toString('base64') }] };
      },
    },
  };

  const adapter = createNvidiaMediaAdapter({ client });
  assert.equal(adapter.provider, 'nvidia');
  assert.equal(adapter.model, DEFAULT_IMAGE_MODEL);
  assert.equal(adapter.supports({ capability: CAPABILITIES.IMAGE_GENERATION }), true);
  assert.equal(adapter.supports({ capability: 'image-generation' }), true);
  assert.equal(adapter.supports({ capability: CAPABILITIES.VIDEO_GENERATION }), false);

  const result = await adapter.generate({
    capability: CAPABILITIES.IMAGE_GENERATION,
    prompt: 'A cinematic mountain landscape at sunrise',
    idempotencyKey: 'asset-test-1',
  });

  assert.equal(received.request.model, DEFAULT_IMAGE_MODEL);
  assert.equal(received.request.prompt, 'A cinematic mountain landscape at sunrise');
  assert.equal(received.options.headers['Idempotency-Key'], 'asset-test-1');
  assert.equal(result.provider, 'nvidia');
  assert.equal(result.model, DEFAULT_IMAGE_MODEL);
  assert.equal(result.capability, CAPABILITIES.IMAGE_GENERATION);
  assert.equal(result.artifact.kind, 'image');
  assert.equal(result.artifact.source, 'provider');
  assert.ok(Buffer.isBuffer(result.artifact.bytes));
  assert.equal(result.artifact.bytes.toString(), imageBytes.toString());

  const placeholderClient = {
    images: {
      async generate() { return { id: 'placeholder', data: [{ url: 'placeholder://image' }] }; },
    },
  };
  const placeholderAdapter = createNvidiaMediaAdapter({ client: placeholderClient });
  await assert.rejects(
    () => placeholderAdapter.generate({ capability: CAPABILITIES.IMAGE_GENERATION, prompt: 'x' }),
    /no real media artifact/,
  );

  console.log('NVIDIA media adapter certification: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
