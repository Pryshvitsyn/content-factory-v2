'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createControlServer } = require('../apps/dashboard/server/http-server');

function request(server, method, path, body = null) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port: address.port, method, path,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve({
        status: response.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    call.on('error', reject); if (body) call.write(JSON.stringify(body)); call.end();
  });
}

async function main() {
  let providerCalls = 0; const calls = [];
  const avatarService = {
    async verticals() { return [{ code: 'TRAVEL' }]; },
    async list(value) { calls.push(['list', value]); return []; },
    async create(value) { calls.push(['create', value]); return { id: 'avatar-1', currentLevel: 0 }; },
    async avatar(value) { calls.push(['avatar', value]); return { id: value.id }; },
    async importSource(value) { calls.push(['source', value]); return { gate0: { status: 'PASS', externalCalls: 0 } }; },
    async registerPassport(value) { calls.push(['passport', value]); return { passport: { id: 'passport-1' } }; },
    async certifyPassport(value) { calls.push(['certify', value]); return { avatar: { currentLevel: 1 } }; },
    async addLevelAsset(value) { calls.push(['asset', value]); return { asset: {} }; },
    async compileTestPlan(value) { calls.push(['plan', value]); return { externalCallCount: 0, expectedPaidCalls: 0 }; },
  };
  const server = createControlServer({ service: {}, avatarService, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'GET', '/api/avatar-studio/verticals')).status, 200);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/avatars?brandId=brand-1&vertical=TRAVEL')).status, 200);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars', { internalName: 'Mara' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/sources', { brandId: 'brand-1' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passports/passport-1/certify',
      { brandId: 'brand-1', humanApproval: true })).status, 201);
    const plan = await request(server, 'POST', '/api/avatar-studio/test-content/plan', { brandId: 'brand-1' });
    assert.equal(plan.status, 201); assert.equal(plan.payload.externalCallCount, 0);
    assert.deepEqual(calls.find(([name]) => name === 'list')[1], { brandId: 'brand-1', vertical: 'TRAVEL' });
    assert.equal(calls.find(([name]) => name === 'certify')[1].passportId, 'passport-1');
    assert.equal(providerCalls, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  console.log('Avatar Studio dashboard API routing passed; provider calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
