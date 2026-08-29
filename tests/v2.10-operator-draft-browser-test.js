'use strict';

const assert = require('node:assert/strict');
const { CreativeProductionService, normalizeV210Video } = require('../src/v2.10/creative-production-service');
const { createControlServer } = require('../apps/dashboard/server/http-server');

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';

async function main() {
  const rows = [{ id: DRAFT_ID, brand_id: BRAND_ID, workspace_id: WORKSPACE_ID, status: 'DRAFT', revision: 7,
    creative_brief: { title: 'Resume me' }, provider_selection: { provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD', resolution: '720p' } }];
  let listQuery = null;
  const repository = {
    db: { async query(sql, values) { listQuery = { sql, values }; return { rows }; } },
    async getDraft({ id, workspaceId, brandId }) {
      return id === DRAFT_ID && workspaceId === WORKSPACE_ID && brandId === BRAND_ID ? rows[0] : null;
    },
  };
  const brandRepository = { async getBrand(id) { return id === BRAND_ID ? { id, workspaceId: WORKSPACE_ID, name: 'Attune' } : null; } };
  const service = new CreativeProductionService({ repository, brandRepository });

  const listed = await service.listDrafts({ brandId: BRAND_ID, limit: 999 });
  assert.equal(listed[0].id, DRAFT_ID);
  assert.equal(listQuery.values[0], WORKSPACE_ID);
  assert.equal(listQuery.values[1], BRAND_ID);
  assert.equal(listQuery.values[2], 50, 'operator draft browser limit must be capped');
  assert.match(listQuery.sql, /workspace_id=\$1 AND brand_id=\$2/);
  assert.equal((await service.getDraft({ id: DRAFT_ID, brandId: BRAND_ID })).revision, 7);
  await assert.rejects(() => service.listDrafts({}), (error) => error.code === 'BRAND_REQUIRED');
  await assert.rejects(() => service.getDraft({ id: '00000000-0000-4000-8000-000000000000', brandId: BRAND_ID }),
    (error) => error.code === 'DRAFT_NOT_FOUND');

  assert.deepEqual(normalizeV210Video({ profile: 'QUALITY', resolution: '1080x1920' }),
    { profile: 'STANDARD', resolution: null });
  assert.deepEqual(normalizeV210Video({ profile: 'PREMIUM', resolution: '1080p' }),
    { profile: 'PREMIUM', resolution: '1080p' });

  const server = createControlServer({ service: {}, creativeService: service, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/v2.10/creative-drafts?brandId=${BRAND_ID}`);
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json())[0].id, DRAFT_ID);
    const itemResponse = await fetch(`http://127.0.0.1:${port}/api/v2.10/creative-drafts/${DRAFT_ID}?brandId=${BRAND_ID}`);
    assert.equal(itemResponse.status, 200);
    assert.equal((await itemResponse.json()).creative_brief.title, 'Resume me');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log('V2.10 operator draft browser passed: scoped resume GETs, capped listing, legacy UI normalization; external provider calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
