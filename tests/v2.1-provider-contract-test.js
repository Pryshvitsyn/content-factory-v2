'use strict';

const assert = require('node:assert/strict');
const { assertProviderResult, MEDIA_CAPABILITIES } = require('../src/providers/provider-contract');

function run() {
  assert(MEDIA_CAPABILITIES.has('video-generation'));
  assert(MEDIA_CAPABILITIES.has('image-generation'));
  assert(MEDIA_CAPABILITIES.has('speech-generation'));
  assert(MEDIA_CAPABILITIES.has('audio-generation'));

  const text = assertProviderResult({
    provider: 'nvidia',
    model: 'nvidia/test-text',
    capability: 'text-generation',
    output: 'hello',
  });
  assert.equal(text.output, 'hello');
  assert.equal(text.mediaUrl, null);

  const video = assertProviderResult({
    provider: 'nvidia',
    model: 'nvidia/test-video',
    capability: 'video-generation',
    output: Buffer.from('mp4'),
    contentType: 'video/mp4',
    temporal: { startMs: 0, endMs: 3000, durationMs: 3000 },
    provenance: { provider: 'nvidia', model: 'nvidia/test-video' },
    requestId: 'req-video-1',
  });
  assert.equal(video.contentType, 'video/mp4');
  assert.equal(video.output.toString(), 'mp4');
  assert.deepEqual(video.temporal, { startMs: 0, endMs: 3000, durationMs: 3000 });
  assert.equal(video.provenance.provider, 'nvidia');
  assert(Object.isFrozen(video));

  const imageUrl = assertProviderResult({
    provider: 'future-provider',
    model: 'future-image-model',
    capability: 'image-generation',
    mediaUrl: 'https://example.invalid/image.png',
    contentType: 'image/png',
  });
  assert.equal(imageUrl.mediaUrl, 'https://example.invalid/image.png');

  assert.throws(
    () => assertProviderResult({ provider: 'nvidia', model: 'nvidia/test-video', capability: 'video-generation', output: 'placeholder' }),
    /Media provider result must include contentType/,
  );

  assert.throws(
    () => assertProviderResult({ provider: 'nvidia', model: 'nvidia/test-video', capability: 'video-generation', contentType: 'video/mp4' }),
    /normalized contract/,
  );

  console.log('v2.1 provider-neutral generation contract: PASS');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
