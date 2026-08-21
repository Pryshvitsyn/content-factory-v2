'use strict';

const assert = require('node:assert/strict');
const { createProvider, createResearchRegistry } = require('../worker/v2.5-research-provider-layer');

const fetchImpl = async (url) => new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { 'content-type': 'application/json', 'x-title': url.hostname }
});

const provider = createProvider({
  id: 'fixture-web',
  type: 'web',
  discover: async () => ['https://source-a.example.test/data'],
  fetchOptions: { fetchImpl }
});

assert.deepEqual(provider.id, 'fixture-web');
assert.equal(provider.type, 'web');

const registry = createResearchRegistry([provider]);
assert.deepEqual(registry.list(), [{ id: 'fixture-web', type: 'web' }]);
assert.equal(registry.get('fixture-web'), provider);

await provider.research('test').catch((error) => {
  assert.match(error.message, /claims|Research/i);
});

assert.throws(() => createProvider({ id: 'bad', type: 'unknown', discover: async () => [] }), /valid id and type/);
assert.throws(() => createResearchRegistry([provider, provider]), /duplicate provider/);

console.log('V2.5 research provider layer certification: PASS');
