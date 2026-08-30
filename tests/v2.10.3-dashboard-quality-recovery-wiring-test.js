'use strict';

const assert = require('node:assert/strict');
const { wireQualityRecoveryShotRegeneration } = require('../apps/dashboard/server');

(async () => {
  const calls = [];
  const commandService = {
    async preflightShotRegeneration(args) { calls.push(['preflight', args]); return args; },
    async regenerateShot(args) { calls.push(['regenerate', args]); return args; },
  };
  let inspections = 0;
  const qualityRecoveryService = {
    async inspect({ productionId, brandId }) {
      inspections += 1;
      assert.equal(productionId, 'production-1');
      assert.equal(brandId, 'brand-1');
      return { action: 'REGENERATE_SHOT', shotId: 'shot-2', recoveryKind: 'SOURCE_GEOMETRY' };
    },
  };

  wireQualityRecoveryShotRegeneration(commandService, qualityRecoveryService);

  const preflight = await commandService.preflightShotRegeneration({
    productionId: 'production-1', brandId: 'brand-1', shotId: 'shot-2', requestId: 'request-1',
  });
  assert.equal(preflight.recoveryReason, 'SOURCE_GEOMETRY');

  const regenerate = await commandService.regenerateShot({
    productionId: 'production-1', brandId: 'brand-1', shotId: 'shot-2', requestId: 'request-1', confirmation: true,
  });
  assert.equal(regenerate.recoveryReason, 'SOURCE_GEOMETRY');

  const unrelated = await commandService.preflightShotRegeneration({
    productionId: 'production-1', brandId: 'brand-1', shotId: 'shot-1', requestId: 'request-2',
  });
  assert.equal(unrelated.recoveryReason, undefined);

  const explicit = await commandService.preflightShotRegeneration({
    productionId: 'production-1', brandId: 'brand-1', shotId: 'shot-2', requestId: 'request-3',
    recoveryReason: 'SOURCE_CONTINUITY',
  });
  assert.equal(explicit.recoveryReason, 'SOURCE_CONTINUITY');
  assert.equal(inspections, 3, 'Explicit recoveryReason must bypass recovery reclassification');

  assert.equal(calls.length, 4);
  console.log('V2.10.3 dashboard quality-recovery wiring: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
