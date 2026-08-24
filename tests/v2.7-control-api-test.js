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
    async preflightProduction(body) { calls.push(['preflight', body]); return { preflightId: 'fingerprint', preflightProviderExecutions: 0 }; },
    async createProduction(body) { calls.push(['create', body]); return { productionId: PRODUCTION_ID, jobStatus: 'QUEUED' }; },
    async startProduction(body) { calls.push(['start', body]); return { productionId: PRODUCTION_ID, accepted: true }; },
    async retryProduction(body) { calls.push(['retry', body]); return { productionId: PRODUCTION_ID, accepted: true }; },
    async regenerateProduction(body) { calls.push(['regenerate', body]); return { productionId: 'new-production', requiresExplicitStart: true }; },
  };
  const server = createControlServer({ service, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const preflight = await post(base, '/api/productions/preflight', { brandId: BRAND_ID, renderMode: 'FAST' });
    assert.equal(preflight.status, 200); assert.equal(preflight.payload.preflightProviderExecutions, 0);
    assert.deepEqual(calls.map(([name]) => name), ['preflight'], 'preflight must not create or start production');
    const created = await post(base, '/api/productions', { request: { brandId: BRAND_ID }, preflightId: 'fingerprint' });
    assert.equal(created.status, 201); assert.equal(created.payload.jobStatus, 'QUEUED');
    const started = await post(base, `/api/productions/${PRODUCTION_ID}/start`, { brandId: BRAND_ID, confirmation: true });
    assert.equal(started.status, 202); assert.equal(started.payload.accepted, true);
    const retried = await post(base, `/api/productions/${PRODUCTION_ID}/retry`, { brandId: BRAND_ID });
    assert.equal(retried.status, 202);
    const regenerated = await post(base, `/api/productions/${PRODUCTION_ID}/regenerate`, {
      brandId: BRAND_ID, requestId: '33333333-3333-4333-8333-333333333333', reason: 'Stronger hook',
    });
    assert.equal(regenerated.status, 201); assert.equal(regenerated.payload.requiresExplicitStart, true);
    assert.deepEqual(calls.map(([name]) => name), ['preflight','create','start','retry','regenerate']);
    console.log('V2.7 Control API production command routes passed (zero provider calls).');
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
