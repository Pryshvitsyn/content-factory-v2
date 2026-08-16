'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, validateEditManifest, buildEditManifest } = require('../worker/v2.1-edit');

function fixture() {
  const production = { id: 'prod-1', context_fingerprint: 'ctx-1' };
  const continuity = { artifact_id: 'continuity-1', output_hash: 'continuity-hash' };
  const shots = [
    { id: 'shot-1', shot_number: 1, duration_ms: 1000, instructions: { camera: 'wide' } },
    { id: 'shot-2', shot_number: 2, duration_ms: 1500, instructions: { camera: 'close' } },
  ];
  const requirements = [
    { id: 'req-1', shot_id: 'shot-1', required_asset_type: 'CHARACTER', resolved_asset_id: 'asset-1', resolved_asset_version_id: 'ver-1', status: 'SATISFIED' },
    { id: 'req-2', shot_id: 'shot-2', required_asset_type: 'CHARACTER', resolved_asset_id: 'asset-1', resolved_asset_version_id: 'ver-1', status: 'SATISFIED' },
  ];
  const versions = [{ version_id: 'ver-1', asset_id: 'asset-1', version: 1, asset_type: 'CHARACTER' }];
  return { production, continuity, shots, requirements, versions };
}

test('EDIT fingerprint is stable across object key order', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
});

test('EDIT manifest is deterministic and context-bound', () => {
  const a = buildEditManifest(fixture());
  const b = buildEditManifest(fixture());
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(a.contextFingerprint, 'ctx-1');
  assert.equal(a.continuityFingerprint, 'continuity-hash');
  assert.equal(a.durationMs, 2500);
  assert.deepEqual(a.timeline.map((x) => [x.index, x.startMs, x.endMs]), [[1, 0, 1000], [2, 1000, 2500]]);
});

test('EDIT validator rejects timing gaps', () => {
  const manifest = buildEditManifest(fixture());
  manifest.timeline[1].startMs = 1100;
  assert.throws(() => validateEditManifest(manifest), /timing gap or overlap/);
});

test('EDIT validator rejects missing asset versions', () => {
  const manifest = buildEditManifest(fixture());
  manifest.timeline[0].assetVersionIds = [];
  assert.throws(() => validateEditManifest(manifest), /no asset versions/);
});
