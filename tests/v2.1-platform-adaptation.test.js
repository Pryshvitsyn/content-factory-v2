'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, normalizePlatforms, validateEditionManifest, buildEditionManifest } = require('../worker/v2.1-platform-adaptation');

test('platform list normalization is deterministic', () => {
  assert.deepEqual(normalizePlatforms(['youtube_shorts', 'TIKTOK', 'tiktok']), ['TIKTOK', 'YOUTUBE_SHORTS']);
});

test('edition fingerprint is stable across object key order', () => {
  const a = { platform: 'TIKTOK', contextFingerprint: 'ctx-1', timeline: [{ index: 1, startMs: 0, endMs: 1000 }] };
  const b = { timeline: [{ endMs: 1000, startMs: 0, index: 1 }], contextFingerprint: 'ctx-1', platform: 'TIKTOK' };
  assert.equal(fingerprint(a), fingerprint(b));
});

test('platform edition preserves canonical EDIT provenance', () => {
  const manifest = buildEditionManifest({
    platform: 'TIKTOK',
    contextFingerprint: 'ctx-1',
    editArtifactId: 'edit-1',
    editFingerprint: 'edit-hash',
    editMetadata: {
      manifest: {
        durationMs: 2500,
        timeline: [
          { index: 1, shotId: 'shot-1', shotNumber: 1, startMs: 0, endMs: 1000, durationMs: 1000, assetVersionIds: ['asset-v1'] },
          { index: 2, shotId: 'shot-2', shotNumber: 2, startMs: 1000, endMs: 2500, durationMs: 1500, assetVersionIds: ['asset-v2'] },
        ],
      },
    },
  });
  assert.equal(manifest.sourceEditArtifactId, 'edit-1');
  assert.equal(manifest.sourceEditFingerprint, 'edit-hash');
  assert.equal(manifest.contextFingerprint, 'ctx-1');
  assert.equal(manifest.durationMs, 2500);
  assert.deepEqual(manifest.timeline.map((x) => [x.index, x.startMs, x.endMs]), [[1, 0, 1000], [2, 1000, 2500]]);
  assert.equal(validateEditionManifest(manifest), true);
});

test('edition validator rejects timing gaps', () => {
  assert.throws(() => validateEditionManifest({
    type: 'PLATFORM_EDITION', version: 1, platform: 'TIKTOK', profileVersion: 1,
    contextFingerprint: 'ctx-1', sourceEditArtifactId: 'edit-1', sourceEditFingerprint: 'hash', durationMs: 2000,
    timeline: [
      { index: 1, startMs: 0, endMs: 1000 },
      { index: 2, startMs: 1100, endMs: 2000 },
    ],
  }), /timing/);
});
