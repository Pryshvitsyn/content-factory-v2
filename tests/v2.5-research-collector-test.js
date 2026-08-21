'use strict';

const assert = require('node:assert/strict');
const { fetchSource, collectEvidence } = require('../worker/v2.5-research-collector');

function response(body, headers = {}) {
  return { ok: true, status: 200, headers: { get: key => headers[key.toLowerCase()] || null }, text: async () => body };
}

(async () => {
  const fetched = await fetchSource('https://example.com/data', {
    fetchImpl: async () => response('small evidence', { 'content-type': 'text/plain', 'x-title': 'Example Data' }),
    timeoutMs: 1000
  });
  assert.equal(fetched.title, 'Example Data');
  assert.equal(fetched.body, 'small evidence');

  await assert.rejects(() => fetchSource('file:///etc/passwd', { fetchImpl: async () => response('x') }), /HTTP\(S\)/);
  await assert.rejects(() => fetchSource('https://example.com/large', {
    fetchImpl: async () => response('0123456789'), maxBytes: 5
  }), /byte budget/);

  const research = await collectEvidence({
    sources: ['https://a.example/one', 'https://b.example/two'],
    fetchOptions: { fetchImpl: async url => response(`evidence:${url.hostname}`) },
    extractClaims: (fetched, records) => fetched.map((item, i) => ({
      claim: item.body,
      classification: 'FACT',
      confidence: 'MEDIUM',
      source_ids: [records[i].source_id]
    }))
  });
  assert.equal(research.sources.length, 2);
  assert.equal(research.cross_check.independent_source_count, 2);
  assert.equal(research.claims.length, 2);

  console.log('V2.5 bounded research collector certification: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
