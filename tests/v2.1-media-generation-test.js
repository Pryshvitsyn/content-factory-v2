'use strict';

const assert = require('node:assert/strict');
const { capabilityForAssetKind, normalizeMediaResult, generateMediaAsset } = require('../worker/v2.1-media-generation');

async function main() {
  assert.equal(capabilityForAssetKind('image'), 'image-generation');
  assert.equal(capabilityForAssetKind('video'), 'video-generation');
  assert.equal(capabilityForAssetKind('voice'), 'speech-generation');
  assert.equal(capabilityForAssetKind('audio'), 'audio-generation');
  assert.throws(() => capabilityForAssetKind('document'), /Unsupported media asset kind/);

  const binary = normalizeMediaResult({
    asset: { asset_id: 'hero-1', kind: 'image' },
    response: {
      output: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
      provider: 'test-image',
      model: 'test-model',
      requestId: 'req-1',
    },
  });
  assert.equal(binary.contentType, 'image/png');
  assert.equal(binary.bytes.length, 3);
  assert.equal(binary.mediaUrl, null);
  assert.equal(binary.provider, 'test-image');

  const remote = normalizeMediaResult({
    asset: { asset_id: 'clip-1', kind: 'video' },
    response: {
      mediaUrl: 'https://example.invalid/video.mp4',
      contentType: 'video/mp4',
      provenance: { provider: 'test-video', model: 'test-video-model' },
    },
  });
  assert.equal(remote.mediaUrl, 'https://example.invalid/video.mp4');
  assert.equal(remote.contentType, 'video/mp4');
  assert.equal(remote.bytes, null);

  const calls = [];
  const result = await generateMediaAsset({
    productionId: 'prod-1',
    workerId: 'worker-1',
    asset: {
      asset_id: 'voice-1',
      kind: 'voice',
      description: 'Italian voiceover',
      source_preference: 'generate',
      generation_requirements: { language: 'it' },
      required_for_shots: ['shot-1'],
    },
    providerGateway: {
      async generate(request) {
        calls.push(request);
        return {
          output: Buffer.from('audio'),
          contentType: 'audio/mpeg',
          provider: 'test-voice',
          model: 'test-voice-model',
        };
      },
    },
  });

  assert.equal(result.kind, 'voice');
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.provider, 'test-voice');
  assert.equal(calls[0].capability, 'speech-generation');
  assert.equal(calls[0].idempotencyKey, 'prod-1:media:voice-1');
  assert.equal(calls[0].metadata.assetKind, 'voice');

  assert.throws(
    () => normalizeMediaResult({ asset: { asset_id: 'bad', kind: 'image' }, response: { output: Buffer.from('x') } }),
    /must return contentType/,
  );
  assert.throws(
    () => normalizeMediaResult({ asset: { asset_id: 'bad', kind: 'image' }, response: { contentType: 'image/png' } }),
    /neither bytes nor URL/,
  );

  console.log('v2.1 media generation certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
