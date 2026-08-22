'use strict';

const assert = require('node:assert/strict');
const { buildRenderManifest, buildMasterArtifactDescriptor, renderMaster } = require('../worker/v2.1-renderer-master-builder');

async function main() {
  const assembly = {
    productionId: 'prod-1', fps: 30, durationMs: 4000,
    videoTracks: [{ id: 'v1', assetId: 'image-1', startMs: 0, endMs: 4000, sourceOffsetMs: 0, media: { mediaUrl: 'https://example/image', contentType: 'image/png' } }],
    audioTracks: [{ id: 'a1', assetId: 'voice-1', startMs: 0, endMs: 4000, sourceOffsetMs: 0, media: { mediaUrl: 'https://example/audio', contentType: 'audio/mpeg' } }],
    clips: [{ id: 'v1', assetId: 'image-1', startMs: 0, endMs: 4000, sourceOffsetMs: 0 }],
  };

  const manifest = buildRenderManifest({ assembly });
  assert.equal(manifest.durationMs, 4000);
  assert.equal(manifest.tracks.video[0].startMs, 0);
  assert.equal(manifest.tracks.audio[0].endMs, 4000);

  const descriptor = buildMasterArtifactDescriptor({ manifest, artifactId: 'master-1' });
  assert.equal(descriptor.immutable, true);
  assert.equal(descriptor.kind, 'media-master');

  const result = await renderMaster({
    renderer: { render: async ({ manifest: input }) => ({ output: Buffer.from(JSON.stringify(input)), contentType: 'video/mp4', renderer: 'test-renderer', rendererVersion: '1' }) },
    manifest, artifactId: 'master-1', idempotencyKey: 'prod-1:master:1',
  });
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.artifact.immutable, true);
  assert.ok(Buffer.isBuffer(result.output));

  await assert.rejects(() => renderMaster({ renderer: { render: async () => ({}) }, manifest, artifactId: 'master-1', idempotencyKey: 'x' }), /neither bytes nor URL/);
  console.log('V2.1 renderer master builder certification: PASS');
}

main().catch((error) => { console.error(error); process.exit(1); });
