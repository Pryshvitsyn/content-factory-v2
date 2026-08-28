'use strict';

const assert = require('node:assert/strict');
const { createControlServer } = require('../apps/dashboard/server/http-server');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTION_ID = '22222222-2222-4222-8222-222222222222';

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, payload: await response.json() };
}

async function main() {
  const calls = [];
  const service = {
    async preflightProduction(body) {
      calls.push(['preflight', body]);
      if (body.invalid) throw Object.assign(new Error('Preflight is NOT READY'), { status: 409,
        code: 'LIVE_PREFLIGHT_VALIDATION_FAILED', details: { providerExecutions: 0,
          validation: { status: 'FAIL', checks: [{ code: 'voice_copy_integrity', status: 'FAIL',
            message: 'Planned speech text mismatch.', details: { actual: 'a', expected: 'b' } }] } } });
      return { preflightId: 'fingerprint', preflightProviderExecutions: 0 };
    },
    async createProduction(body) { calls.push(['create', body]); return { productionId: PRODUCTION_ID, jobStatus: 'QUEUED' }; },
    async startProduction(body) { calls.push(['start', body]); return { productionId: PRODUCTION_ID, accepted: true }; },
    async retryProduction(body) { calls.push(['retry', body]); return { productionId: PRODUCTION_ID, accepted: true }; },
    async preflightSemanticRetry(body) { calls.push(['semantic-preflight', body]); return {
      expectedVideoGenerations: 0, expectedSpeechGenerations: 0, expectedSemanticEvaluations: 1,
    }; },
    async retrySemanticEvaluation(body) { calls.push(['semantic-retry', body]); return { accepted: true, publicationTriggered: false }; },
    async regenerateProduction(body) { calls.push(['regenerate', body]); return { productionId: 'new-production', requiresExplicitStart: true }; },
    async preflightShotRegeneration(body) { calls.push(['shot-preflight', body]); return { preflightId: 'shot-fingerprint', expectedProviderCalls: 1, providerCalls: 0 }; },
    async regenerateShot(body) { calls.push(['shot-regenerate', body]); return { regenerationId: 'shot-revision', accepted: true, publicationTriggered: false }; },
    async addProviderModel(body) { calls.push(['add-model', body]); return { id: 'catalog-model', provider: body.provider, modelId: body.modelId }; },
  };
  const server = createControlServer({ service, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const preflight = await post(base, '/api/productions/preflight', { brandId: BRAND_ID, renderMode: 'FAST' });
    assert.equal(preflight.status, 200); assert.equal(preflight.payload.preflightProviderExecutions, 0);
    assert.deepEqual(calls.map(([name]) => name), ['preflight'], 'preflight must not create or start production');
    const blocked = await post(base, '/api/productions/preflight', { brandId: BRAND_ID, invalid: true });
    assert.equal(blocked.status, 409); assert.equal(blocked.payload.error.details.providerExecutions, 0);
    assert.equal(blocked.payload.error.details.validation.checks[0].code, 'voice_copy_integrity');
    const created = await post(base, '/api/productions', { request: { brandId: BRAND_ID }, preflightId: 'fingerprint' });
    assert.equal(created.status, 201); assert.equal(created.payload.jobStatus, 'QUEUED');
    const started = await post(base, `/api/productions/${PRODUCTION_ID}/start`, { brandId: BRAND_ID, confirmation: true });
    assert.equal(started.status, 202); assert.equal(started.payload.accepted, true);
    const retried = await post(base, `/api/productions/${PRODUCTION_ID}/retry`, { brandId: BRAND_ID });
    assert.equal(retried.status, 202);
    const semanticPreflight = await post(base, `/api/productions/${PRODUCTION_ID}/semantic-retry/preflight`, { brandId: BRAND_ID });
    assert.deepEqual([semanticPreflight.payload.expectedVideoGenerations, semanticPreflight.payload.expectedSpeechGenerations,
      semanticPreflight.payload.expectedSemanticEvaluations], [0, 0, 1]);
    const semanticRetry = await post(base, `/api/productions/${PRODUCTION_ID}/semantic-retry`, {
      brandId: BRAND_ID, confirmation: true,
    });
    assert.equal(semanticRetry.status, 202); assert.equal(semanticRetry.payload.publicationTriggered, false);
    const regenerated = await post(base, `/api/productions/${PRODUCTION_ID}/regenerate`, {
      brandId: BRAND_ID, requestId: '33333333-3333-4333-8333-333333333333', reason: 'Stronger hook',
    });
    assert.equal(regenerated.status, 201); assert.equal(regenerated.payload.requiresExplicitStart, true);
    const shotPreflight = await post(base, `/api/productions/${PRODUCTION_ID}/shots/operator-shot-1/preflight`, {
      brandId: BRAND_ID, requestId: '44444444-4444-4444-8444-444444444444', instruction: 'Quieter pause',
    });
    assert.equal(shotPreflight.status, 200); assert.equal(shotPreflight.payload.providerCalls, 0);
    const shotRegenerated = await post(base, `/api/productions/${PRODUCTION_ID}/shots/operator-shot-1/regenerate`, {
      brandId: BRAND_ID, requestId: '44444444-4444-4444-8444-444444444444', instruction: 'Quieter pause',
      preflightId: 'shot-fingerprint', confirmation: true,
    });
    assert.equal(shotRegenerated.status, 202); assert.equal(shotRegenerated.payload.publicationTriggered, false);
    const added = await post(base, '/api/provider-models', { brandId: BRAND_ID, provider: 'fal', modelId: 'acme/video', preset: 'VIDEO_STANDARD' });
    assert.equal(added.status, 201); assert.equal(added.payload.modelId, 'acme/video');
    assert.deepEqual(calls.map(([name]) => name), ['preflight','preflight','create','start','retry','semantic-preflight',
      'semantic-retry','regenerate','shot-preflight','shot-regenerate','add-model']);
    console.log('V2.7 Control API production command routes passed (zero provider calls).');
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
