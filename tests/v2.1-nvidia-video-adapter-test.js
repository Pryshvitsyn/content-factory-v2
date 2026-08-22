'use strict';

const assert = require('node:assert/strict');
const { createNvidiaVideoAdapter } = require('../src/providers/nvidia-video-adapter');

const fakeMp4 = Buffer.from('00000018667479706d70343200000000', 'hex').toString('base64');

async function run() {
  const calls = [];
  const adapter = createNvidiaVideoAdapter({
    apiKey: 'test-key',
    baseURL: 'https://nvidia.test/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'video-request-1',
            data: [{ b64_json: fakeMp4 }],
          };
        },
      };
    },
  });

  assert.equal(adapter.supports({ capability: 'video-generation' }), true);
  assert.equal(adapter.supports({ capability: 'text-generation' }), false);
  assert.equal(adapter.supports({ capability: 'video-generation', model: 'other/model' }), false);

  const result = await adapter.generate({
    prompt: 'A cinematic sunrise over Rome',
    inputReference: 'data:image/jpeg;base64,AAAA',
    size: '832x480',
    seconds: 4,
    idempotencyKey: 'video-idem-1',
  });

  assert.equal(result.provider, 'nvidia');
  assert.equal(result.model, 'wan-ai/wan2.2');
  assert.equal(result.requestId, 'video-request-1');
  assert.equal(result.raw.mediaType, 'video/mp4');
  assert.equal(result.raw.seconds, 4);
  assert.equal(Buffer.from(result.output, 'base64').subarray(4, 8).toString('ascii'), 'ftyp');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://nvidia.test/v1/videos/generations');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'video-idem-1');
  const request = JSON.parse(calls[0].options.body);
  assert.deepEqual(request, {
    model: 'wan-ai/wan2.2',
    prompt: 'A cinematic sunrise over Rome',
    input_reference: 'data:image/jpeg;base64,AAAA',
    size: '832x480',
    seconds: 4,
  });

  const rejectingAdapter = createNvidiaVideoAdapter({
    apiKey: 'test-key',
    baseURL: 'https://nvidia.test/v1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { id: 'placeholder', data: [{ b64_json: Buffer.from('placeholder').toString('base64') }] }; },
    }),
  });

  await assert.rejects(
    rejectingAdapter.generate({ prompt: 'must fail' }),
    /no real MP4 video artifact/,
  );

  console.log('V2.1 NVIDIA video adapter certification: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
