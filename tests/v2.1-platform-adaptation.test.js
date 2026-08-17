'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, validatePlatformManifest, resolvePlatforms, buildPlatformManifest } = require('../worker/v2.1-platform-adaptation');

function fixture() {
  return {
    production: {
      context_fingerprint: 'ctx-1',
      metadata: { platforms: ['TIKTOK', 'YOUTUBE_SHORTS'], platformProfiles: { TIKTOK: { aspectRatio: '9:16' } } },
      target_platform: null,
    },
    edit: {
      artifact_id: 'edit-1',
      output_hash: 'edit-hash',
      metadata: {
        contextFingerprint: 'ctx-1',
        durationMs: 2500,
        manifest: {
          timeline: [
            { index: 1, shotId: 'shot-1', startMs: 0, endMs: 1000, durationMs: 1000, assetVersionIds: ['asset-v1'] },
            { index: 2, shotId: 'shot-2', startMs: 1000, endMs: 2500, durationMs: 1500, assetVersionIds: ['asset-v2'] },
          ],
        },
      },
    },
  };
}

test('platform manifest fingerprint is stable across object key order', () => {
  const f = fixture();
  const a = buildPlatformManifest({ production: f.production, edit: f.edit, platforms: resolvePlatforms(f.production) });
  const reordered = JSON.parse(JSON.stringify(a, Object.keys(a).sort()));
  assert.equal(fingerprint(a), fingerprint(reordered));
});

test('platform adaptation preserves immutable EDIT provenance', () => {
  const f = fixture();
  const manifest = buildPlatformManifest({ production: f.production, edit: f.edit, platforms: resolvePlatforms(f.production) });
  assert.equal(manifest.contextFingerprint, 'ctx-1');
  assert.equal(manifest.editFingerprint, 'edit-hash');
  assert.equal(manifest.sourceEditArtifactId, 'edit-1');
  assert.deepEqual(manifest.editions.map((x) => x.platform), ['TIKTOK', 'YOUTUBE_SHORTS']);
});

test('validator rejects duplicate platform editions', () => {
  const f = fixture();
  const manifest = buildPlatformManifest({ production: f.production, edit: f.edit, platforms: ['TIKTOK'] });
  manifest.editions.push({ ...manifest.editions[0] });
  assert.throws(() => validatePlatformManifest(manifest), /Duplicate platform/);
});

test('validator rejects unsupported platform', () => {
  const f = fixture();
  const manifest = buildPlatformManifest({ production: f.production, edit: f.edit, platforms: ['TIKTOK'] });
  manifest.editions[0].platform = 'FACEBOOK';
  assert.throws(() => validatePlatformManifest(manifest), /Unsupported platform/);
});

test('fingerprint changes when EDIT provenance changes', () => {
  const f = fixture();
  const a = buildPlatformManifest({ production: f.production, edit: f.edit, platforms: resolvePlatforms(f.production) });
  const changed = { ...f.edit, output_hash: 'different-edit-hash' };
  const b = buildPlatformManifest({ production: f.production, edit: changed, platforms: resolvePlatforms(f.production) });
  assert.notEqual(fingerprint(a), fingerprint(b));
});
