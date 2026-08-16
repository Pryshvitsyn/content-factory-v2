'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContinuityFingerprint, validateContinuityReport, buildChecks } = require('../worker/v2.1-continuity');

const production = { id: 'production-1', context_fingerprint: 'ctx-1', tenant_id: 'tenant-1', business_id: 'business-1', brand_id: 'brand-1' };
const bible = { id: 'bible-artifact-1', productionBibleId: 'bible-1', version: 1, contextFingerprint: 'ctx-1', outputHash: 'bible-hash' };
const shots = [{ shotNumber: 1, durationMs: 1000, instructions: { description: 'hero shot' }, production_bible_id: 'bible-1', context_fingerprint: 'ctx-1' }];
const requirements = [{ id: 'req-1', shot_id: 'shot-1', asset_role: 'hero', required_asset_type: 'CHARACTER', required_asset_id: 'canonical-1', resolved_asset_id: 'asset-1', resolved_asset_version_id: 'version-1', resolution_fingerprint: 'resolution-1', status: 'SATISFIED', production_bible_id: 'bible-1', context_fingerprint: 'ctx-1', plan_fingerprint: 'plan-1' }];
const assets = [{ id: 'asset-1', tenant_id: 'tenant-1', business_id: 'business-1', brand_id: 'brand-1', asset_type: 'CHARACTER', identity_fingerprint: 'identity-1', version_id: 'version-1', version: 1, version_data: { look: 'hero' } }];

function report() {
  return {
    type: 'CONTINUITY_REPORT', version: 1, status: 'PASS', contextFingerprint: 'ctx-1',
    continuityFingerprint: buildContinuityFingerprint({ production, bible, shots, requirements, assets }),
    checks: [{ name: 'production_context', status: 'PASS' }],
  };
}

test('CONTINUITY fingerprint is stable across object key order', () => {
  const a = buildContinuityFingerprint({ production, bible, shots, requirements, assets });
  const b = buildContinuityFingerprint({ production: { context_fingerprint: 'ctx-1', id: 'production-1' }, bible, shots, requirements, assets });
  assert.equal(a, b);
});

test('CONTINUITY validator accepts canonical report', () => assert.equal(validateContinuityReport(report()), true));

test('CONTINUITY validator rejects failed checks', () => {
  assert.throws(() => validateContinuityReport({ ...report(), checks: [{ name: 'asset_type', status: 'FAIL' }] }), /asset_type is not PASS/);
});

test('CONTINUITY checks detect asset type drift', () => {
  const checks = buildChecks({ production, bible, shots, requirements, assets: [{ ...assets[0], asset_type: 'LOCATION' }], assetsArtifact: { metadata: { contextFingerprint: 'ctx-1' } } });
  assert.equal(checks.find((check) => check.name === 'asset_type_compatibility').status, 'FAIL');
});

test('CONTINUITY checks require immutable context on the ASSETS artifact', () => {
  const checks = buildChecks({ production, bible, shots, requirements, assets, assetsArtifact: { metadata: { contextFingerprint: 'wrong-context' } } });
  assert.equal(checks.find((check) => check.name === 'assets_artifact_provenance').status, 'FAIL');
});
