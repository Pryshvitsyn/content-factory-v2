'use strict';

const assert = require('node:assert/strict');
const { RendererRouter } = require('../src/v2.6/renderer-router');

async function main() {
  const calls = [];
  const lane = (name) => ({
    async preflight() { calls.push(`${name}:preflight`); return { lane: name }; },
    plan() { calls.push(`${name}:plan`); return { lane: name }; },
    async render() { calls.push(`${name}:render`); return { lane: name }; },
  });
  const router = new RendererRouter({ qualityLane: lane('quality'), fastRenderers: { moneyprinterturbo: lane('fast') } });
  assert.deepEqual(await router.preflight({ input: { renderMode: 'QUALITY' } }), { lane: 'quality' });
  assert.deepEqual(router.plan({ input: { renderMode: 'FAST', fastRender: { renderer: 'moneyprinterturbo' } } }), { lane: 'fast' });
  assert.deepEqual(await router.render({ input: { renderMode: 'FAST', fastRender: { renderer: 'moneyprinterturbo' } } }), { lane: 'fast' });
  assert.deepEqual(await router.render({ input: {} }), { lane: 'quality' }, 'legacy input must default to QUALITY');
  assert.deepEqual(calls, ['quality:preflight', 'fast:plan', 'fast:render', 'quality:render']);
  assert.throws(() => router.lane({ renderMode: 'SIDEWAYS' }), (error) => error.code === 'RENDER_MODE_UNSUPPORTED');
  assert.throws(() => router.lane({ renderMode: 'FAST', fastRender: { renderer: 'missing' } }),
    (error) => error.code === 'FAST_RENDERER_UNAVAILABLE');
  console.log('V2.6 renderer router contract passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
