'use strict';

const assert = require('node:assert/strict');
const { normalizeV210Video } = require('../src/v2.10/creative-production-service');
const { persistedDraftScope, revisionSafeProductionKey } = require('../src/v2.10/integrated-starter');

assert.deepEqual(normalizeV210Video({
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'QUALITY', resolution: '1080x1920',
}), {
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD', resolution: null,
});
assert.deepEqual(normalizeV210Video({
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'PREMIUM', resolution: '1080p',
}), {
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'PREMIUM', resolution: '1080p',
});

const draftId = '00000000-0000-4000-8000-000000000001';
const brandId = '00000000-0000-4000-8000-000000000002';
const workspaceA = '00000000-0000-4000-8000-000000000003';
const workspaceB = '00000000-0000-4000-8000-000000000004';
const canonicalInput = {
  fingerprint: 'legacy-fingerprint-a', productionKey: `v210-${draftId}`, liveTestKey: `v210-${draftId}`,
  brandId, title: 'Notice the Moment', objective: 'EXPERIMENT',
  targetDurationSeconds: 15, providerSelection: { provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD' },
  postProduction: { endTitle: { enabled: true, text: "Don't guess. Tune in.", startTime: 13, duration: 2 } },
};
const firstIdentity = revisionSafeProductionKey(draftId, canonicalInput);
const sameExactInput = revisionSafeProductionKey(draftId, {
  ...canonicalInput, fingerprint: 'legacy-fingerprint-b', productionKey: 'some-old-key', liveTestKey: 'some-old-key',
});
assert.equal(firstIdentity.productionKey, sameExactInput.productionKey,
  'legacy/stale canonical key fields must not change exact execution identity');
assert.equal(firstIdentity.executionIdentityFingerprint, sameExactInput.executionIdentityFingerprint);
assert.match(firstIdentity.productionKey, /^v210-[0-9a-f-]+-[0-9a-f]{16}$/,
  'V2.10 canonical production key must be scoped by exact execution identity');
const changedInput = revisionSafeProductionKey(draftId, { ...canonicalInput, title: 'A materially changed creative' });
assert.notEqual(firstIdentity.productionKey, changedInput.productionKey,
  'materially changed canonical input must receive a different production identity');
assert.throws(() => revisionSafeProductionKey(null, canonicalInput), (error) => error.code === 'V210_EXECUTION_IDENTITY_REQUIRED');

assert.deepEqual(persistedDraftScope({ workspace_id: workspaceA, brand_id: brandId }), {
  workspaceId: workspaceA, brandId,
}, 'integrated V2.10 execution must derive scope from the persisted draft, not browser input');
assert.throws(() => persistedDraftScope({ brand_id: brandId }),
  (error) => error.code === 'V210_DRAFT_SCOPE_REQUIRED',
  'canonical preflight/START must fail closed when persisted workspace scope is unavailable');
const workspaceIdentityA = revisionSafeProductionKey(draftId, { ...canonicalInput, workspaceId: workspaceA });
const workspaceIdentityB = revisionSafeProductionKey(draftId, { ...canonicalInput, workspaceId: workspaceB });
assert.notEqual(workspaceIdentityA.productionKey, workspaceIdentityB.productionKey,
  'workspace ownership is material canonical execution identity and cannot collide across workspaces');

require('./v2.10-runtime-integration-core-test');
