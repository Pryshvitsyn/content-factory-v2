'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, normalizePlatforms, validateTimeline, validateEdition } = require('../worker/v2.1-validation');

test('validation platform normalization is deterministic', () => {
  assert.deepEqual(normalizePlatforms(['youtube_shorts', 'TIKTOK', 'tiktok']), ['TIKTOK', 'YOUTUBE_SHORTS']);
});

test('validation fingerprint is stable across object key order', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
});

test('validation rejects timeline gaps and duration drift', () => {
  const validAssets = ['asset-v1'];
  assert.throws(() => validateTimeline([{ index: 1, startMs: 0, endMs: 1000, assetVersionIds: validAssets }, { index: 2, startMs: 1100, endMs: 2000, assetVersionIds: validAssets }], 2000), /timing/);
  assert.throws(() => validateTimeline([{ index: 1, startMs: 0, endMs: 1000, assetVersionIds: validAssets }], 1200), /duration/);
});

test('validation rejects edition provenance drift', () => {
  const edit = { artifact_id: 'edit-1', output_hash: 'edit-hash' };
  const edition = {
    platform: 'TIKTOK', version: 1,
    metadata: {
      stage: 'PLATFORM_ADAPTATION', contextFingerprint: 'ctx-1', sourceEditArtifactId: 'other-edit', sourceEditFingerprint: 'edit-hash', profileVersion: 1,
      manifest: { type: 'PLATFORM_EDITION', platform: 'TIKTOK', contextFingerprint: 'ctx-1', sourceEditArtifactId: 'other-edit', sourceEditFingerprint: 'edit-hash', durationMs: 1000, timeline: [{ index: 1, startMs: 0, endMs: 1000, assetVersionIds: ['a'] }] },
    },
  };
  assert.throws(() => validateEdition({ platform: 'TIKTOK', edition, edit, contextFingerprint: 'ctx-1' }), /canonical EDIT/);
});

test('validation accepts a canonical edition', () => {
  const edit = { artifact_id: 'edit-1', output_hash: 'edit-hash' };
  const edition = {
    platform: 'TIKTOK', version: 1,
    metadata: {
      stage: 'PLATFORM_ADAPTATION', contextFingerprint: 'ctx-1', sourceEditArtifactId: 'edit-1', sourceEditFingerprint: 'edit-hash', profileVersion: 1,
      manifest: { type: 'PLATFORM_EDITION', platform: 'TIKTOK', contextFingerprint: 'ctx-1', sourceEditArtifactId: 'edit-1', sourceEditFingerprint: 'edit-hash', durationMs: 1000, timeline: [{ index: 1, startMs: 0, endMs: 1000, assetVersionIds: ['a'] }] },
    },
  };
  assert.equal(typeof validateEdition({ platform: 'TIKTOK', edition, edit, contextFingerprint: 'ctx-1' }), 'string');
});
