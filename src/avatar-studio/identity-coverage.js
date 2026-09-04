'use strict';
const { loadIdentityIntakePolicy } = require('./identity-intake-policy');

function coverageFromSources(sources = [], intakeForSource = () => null, policy = loadIdentityIntakePolicy()) {
  const coverage = Object.fromEntries(policy.canonicalViewpoints.map((viewpoint) => [viewpoint, false])); const seen = new Set();
  for (const source of sources) {
    if (!source || !(source.roles || []).includes('IDENTITY') || !policy.canonicalViewpoints.includes(source.effectiveViewpoint)) continue;
    const intake = intakeForSource(source); if (!intake || intake.effectiveGate0Status !== 'PASS' || intake.characterId !== source.characterId || intake.brandId !== source.brandId || intake.contentHash !== source.contentHash) continue;
    if (seen.has(intake.contentHash)) continue; seen.add(intake.contentHash); coverage[source.effectiveViewpoint] = true;
  }
  const missingRequired = policy.minimumIdentityCoverage.required.filter((item) => !coverage[item]);
  const missingRecommended = policy.minimumIdentityCoverage.recommended.filter((item) => !coverage[item]);
  const coverageCount = Object.values(coverage).filter(Boolean).length;
  return Object.freeze({ coverage: Object.freeze(coverage), coverageCount, coverageTotal: policy.canonicalViewpoints.length,
    missingRequired: Object.freeze(missingRequired), missingRecommended: Object.freeze(missingRecommended),
    status: missingRequired.length ? 'NOT_READY' : missingRecommended.length ? 'READY_FOR_IDENTITY_LOCK' : 'STRONG_COVERAGE' });
}
module.exports = { coverageFromSources };
