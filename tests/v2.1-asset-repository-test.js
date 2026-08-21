'use strict';

const assert = require('node:assert/strict');
const { PostgresAssetRepository } = require('../src/v2.1/asset-repository');

async function main() {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, asset_id')) return { rows: [{ id: 'r1', asset_id: 'logo', kind: 'image', storageKey: 'assets/logo/v2', version: 2 }] };
      return { rows: [{ id: 'r2', asset_id: 'hero', kind: 'image', storageKey: 'assets/hero/v1', version: 1 }] };
    },
  };
  const repository = new PostgresAssetRepository();
  const reusable = await repository.findReusable({ client, productionId: 'p1', asset: { asset_id: 'logo', kind: 'image' } });
  assert.equal(reusable.storageKey, 'assets/logo/v2');
  const registered = await repository.registerResolved({
    client, productionId: 'p1', asset: { asset_id: 'hero', kind: 'image', description: 'hero' },
    artifact: { storageKey: 'assets/hero/v1', version: 1 }, workerId: 'w1', key: 'hero:image:hero',
  });
  assert.equal(registered.storageKey, 'assets/hero/v1');
  assert.equal(calls.length, 2);
  console.log('v2.1 asset repository certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
