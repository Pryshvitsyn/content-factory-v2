'use strict';

const assert = require('node:assert/strict');
const { createControlServer, BODY_LIMIT } = require('../apps/dashboard/server/http-server');
const { ControlService } = require('../apps/dashboard/server/control-service');
const { describeProviders } = require('../apps/dashboard/server/provider-status');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTION_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';

async function request(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json();
  return { response, payload };
}

async function main() {
  const calls = [];
  const service = {
    providers: [{ capability: 'VIDEO', provider: 'Replicate', configured: false }],
    health: async () => ({ status: 'ok' }), overview: async () => ({ totalBrands: 1 }),
    listBrands: async () => [{ id: BRAND_ID, name: 'Brand' }], getBrand: async (id) => ({ id }),
    listProductions: async (filters) => (calls.push(['productions', filters]), [{ id: PRODUCTION_ID }]),
    production: async (id) => ({ id }), stages: async () => [{ stage: 'SIGNAL' }],
    artifacts: async () => [{ artifactId: 'master' }], reviews: async () => [{ id: REVIEW_ID }],
    decide: async (input) => (calls.push(['decision', input]), { decision: input.decision.toUpperCase() }),
    artifactContent: async () => ({ bytes: Buffer.from('mp4'), contentType: 'video/mp4' }),
  };
  const server = createControlServer({ service, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, assertion] of [
      ['/api/health', (p) => p.status === 'ok'], ['/api/overview', (p) => p.totalBrands === 1],
      ['/api/brands', (p) => p[0].name === 'Brand'], [`/api/brands/${BRAND_ID}`, (p) => p.id === BRAND_ID],
      ['/api/productions', (p) => p[0].id === PRODUCTION_ID], [`/api/productions/${PRODUCTION_ID}`, (p) => p.id === PRODUCTION_ID],
      [`/api/productions/${PRODUCTION_ID}/stages`, (p) => p[0].stage === 'SIGNAL'],
      [`/api/productions/${PRODUCTION_ID}/artifacts`, (p) => p[0].artifactId === 'master'],
      ['/api/reviews', (p) => p[0].id === REVIEW_ID], ['/api/providers', (p) => p[0].capability === 'VIDEO'],
    ]) {
      const result = await request(base, path);
      assert.equal(result.response.status, 200, path);
      assert.ok(assertion(result.payload), path);
    }
    const approved = await request(base, `/api/reviews/${REVIEW_ID}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId: BRAND_ID }),
    });
    assert.equal(approved.payload.decision, 'APPROVE');
    const rejected = await request(base, `/api/reviews/${REVIEW_ID}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId: BRAND_ID, reason: 'Wrong CTA' }),
    });
    assert.equal(rejected.payload.decision, 'REJECT');

    const content = await fetch(`${base}/api/artifacts/${encodeURIComponent('production:master')}/versions/1/content?sourceId=${REVIEW_ID}&brandId=${BRAND_ID}`);
    assert.equal(content.status, 200); assert.equal(content.headers.get('content-type'), 'video/mp4');
    assert.equal(await content.text(), 'mp4');

    const malformed = await request(base, '/api/brands/not-a-uuid');
    assert.equal(malformed.response.status, 200, 'routing layer delegates validation to service');
    const missing = await request(base, '/api/not-found'); assert.equal(missing.response.status, 404);
    const tooLarge = await request(base, `/api/reviews/${REVIEW_ID}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(BODY_LIMIT + 1) }),
    });
    assert.equal(tooLarge.response.status, 413);
  } finally { await new Promise((resolve) => server.close(resolve)); }

  const repository = {
    health: async () => ({}), listBrands: async () => [], overview: async () => ({}),
    getBrand: async () => null, listProductions: async () => [], getProduction: async () => null,
    listReviews: async () => [], resolveArtifact: async () => null,
  };
  const control = new ControlService({ repository, reviewService: { decide: async () => null }, storage: { get: async () => Buffer.alloc(0) }, providers: [] });
  await assert.rejects(() => control.getBrand('bad'), (error) => error.code === 'MALFORMED_ID');
  await assert.rejects(() => control.getBrand(BRAND_ID), (error) => error.code === 'BRAND_NOT_FOUND');
  await assert.rejects(() => control.production(PRODUCTION_ID, BRAND_ID), (error) => error.code === 'PRODUCTION_NOT_FOUND');
  await assert.rejects(() => control.artifactContent({ sourceId: REVIEW_ID, artifactId: '../secret', version: 1, brandId: BRAND_ID }), (error) => error.code === 'ARTIFACT_NOT_FOUND');

  const providerPayload = JSON.stringify(describeProviders({ NVIDIA_API_KEY: 'private-nv', REPLICATE_API_TOKEN: 'private-replicate',
    OPENAI_API_KEY: 'private-openai', MPT_ENABLED: 'true', MPT_BASE_URL: 'http://127.0.0.1:8080',
    MPT_API_KEY: 'private-mpt', FAST_RENDERER: 'moneyprinterturbo', MPT_AUTO_PUBLISH_DISABLED: 'true' }));
  assert.doesNotMatch(providerPayload, /private-(nv|replicate|openai|mpt)/, 'provider response must not expose secrets');
  const fast = JSON.parse(providerPayload).find((item) => item.capability === 'FAST RENDERER');
  assert.equal(fast.provider, 'MoneyPrinterTurbo'); assert.equal(fast.configured, true);
  console.log('V2.3 Control API contract passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
