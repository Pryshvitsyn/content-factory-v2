'use strict';

const assert = require('node:assert/strict');
const { NvidiaVideoAdapter } = require('../src/providers/nvidia-video-adapter');

async function run() {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        b64_video: Buffer.from('fake-mp4').toString('base64'),
        usage: { video_seconds: 1 },
      }),
    };
  };

  const adapter = new NvidiaVideoAdapter({
    apiKey: 'test-key',
    baseURL: 'https://nvidia.test',
    endpoint: '/v1/infer',
    model: 'nvidia/cosmos3-nano',
    fetchImpl: fakeFetch,
  });

  assert.equal(adapter.supports({ capability: 'video-generation' }), true);
  assert.equal(adapter.supports({ capability: 'image-generation' }), false);

  const result = await adapter.generate({
    prompt: 'A cinematic robot walking through a modern city at sunset.',
    resolution: '720_16_9',
    numOutputFrames: 25,
    fps: 24,
    seed: 42,
  });

  assert.equal(result.provider, 'nvidia');
  assert.equal(result.model, 'nvidia/cosmos3-nano');
  assert.equal(result.capability, 'video-generation');
  assert.equal(result.contentType, 'video/mp4');
  assert.deepEqual(result.output, Buffer.from('fake-mp4'));
  assert.equal(request.url, 'https://nvidia.test/v1/infer');

  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'nvidia/cosmos3-nano');
  assert.equal(body.prompt, 'A cinematic robot walking through a modern city at sunset.');
  assert.equal(body.resolution, '720_16_9');
  assert.equal(body.num_output_frames, 25);
  assert.equal(body.fps, 24);
  assert.equal(body.seed, 42);
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');

  console.log('NVIDIA video adapter test: GREEN');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
