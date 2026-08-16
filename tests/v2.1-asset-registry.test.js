'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResolutionFingerprint, fingerprint, stableStringify, requiredAssetIdFromRequirement } = require('../worker/v2.1-asset-registry');

test('asset resolution fingerprint is stable across object key order', () => {
  const a = { production: { id: 'p1', contextFingerprint: 'ctx' }, requirement: { id: 'r1', role: 'hero', type: 'CHARACTER', constraints: { b: 2, a: 1 }, planFingerprint: 'plan' }, resolved: { assetId: 'a1', assetVersionId: 'v1', assetVersion: 2, identityFingerprint: 'asset-fp' } };
  const b = { resolved: { identityFingerprint: 'asset-fp', assetVersion: 2, assetVersionId: 'v1', assetId: 'a1' }, requirement: { planFingerprint: 'plan', constraints: { a: 1, b: 2 }, type: 'CHARACTER', role: 'hero', id: 'r1' }, production: { contextFingerprint: 'ctx', id: 'p1' } };
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(stableStringify(a), stableStringify(b));
});

test('resolution fingerprint includes immutable production context and selected asset version', () => {
  const fp = buildResolutionFingerprint({
    production: { id: 'p1', context_fingerprint: 'immutable-context' },
    requirement: { id: 'r1', shot_id: 's1', asset_role: 'hero', required_asset_type: 'CHARACTER', required_asset_id: 'a1', constraints: {}, plan_fingerprint: 'plan1' },
    asset: { id: 'a1', identity_fingerprint: 'asset1' },
    assetVersion: { id: 'av1', version: 3 },
  });
  assert.equal(typeof fp, 'string');
  assert.equal(fp.length, 64);
});

test('required asset id prefers the canonical requirement field and supports planning constraints', () => {
  assert.equal(requiredAssetIdFromRequirement({ required_asset_id: 'a1', constraints: { requiredAssetId: 'a2' } }), 'a1');
  assert.equal(requiredAssetIdFromRequirement({ required_asset_id: null, constraints: { requiredAssetId: 'a2' } }), 'a2');
  assert.equal(requiredAssetIdFromRequirement({ required_asset_id: null, constraints: {} }), null);
});
