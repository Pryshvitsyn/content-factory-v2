'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveV25Configuration } = require('../src/v2.5/configuration');
const { buildProductionInput } = require('../src/v2.5/production-input');

async function main() {
  const raw = JSON.parse(await fs.readFile(path.resolve('config/productions/attune-fast-example.json'), 'utf8'));
  const input = buildProductionInput(raw);
  assert.equal(input.schemaVersion, 3); assert.equal(input.renderMode, 'FAST');
  assert.equal(input.renderer, 'moneyprinterturbo'); assert.equal(input.targetDurationSeconds, 10);
  assert.equal(input.publicationPolicy.requiresHumanApproval, true); assert.equal(input.publicationPolicy.autoPublish, false);
  assert.equal(input.fastRender.mediaSource, 'pexels'); assert.equal(input.fastRender.captions, true);
  assert.ok(input.assetPlan.assets.filter((asset) => asset.kind === 'video')
    .every((asset) => asset.generation_requirements.provider === 'fast-render-plan'));
  const config = resolveV25Configuration({ LIVE_PAID_GENERATION: 'false', DATABASE_URL: 'postgresql://localhost/test',
    CONTENT_FACTORY_STORAGE_ROOT: '/tmp/content-factory-v26-test', REAL_PRODUCTION_INPUT: 'input.json',
    RENDER_MODE: 'FAST', FAST_RENDERER: 'moneyprinterturbo', MPT_ENABLED: 'true', MPT_BASE_URL: 'http://127.0.0.1:8080',
    MPT_AUTO_PUBLISH_DISABLED: 'true' }, input);
  assert.equal(config.renderMode, 'FAST'); assert.equal(config.live, false); assert.equal(config.fastRenderer.enabled, true);
  assert.equal(config.fastRenderer.version, 'v1.3.3');
  const captionsConflict = structuredClone(raw); captionsConflict.fast_render.captions = false;
  assert.throws(() => buildProductionInput(captionsConflict), /must match captions.enabled/);
  assert.throws(() => resolveV25Configuration({ LIVE_PAID_GENERATION: 'false', DATABASE_URL: 'x',
    CONTENT_FACTORY_STORAGE_ROOT: '/tmp/x', REAL_PRODUCTION_INPUT: 'x', RENDER_MODE: 'QUALITY' }, input),
  (error) => error.code === 'LIVE_RENDER_MODE_CONFLICT');
  assert.throws(() => resolveV25Configuration({ LIVE_PAID_GENERATION: 'false', DATABASE_URL: 'x',
    CONTENT_FACTORY_STORAGE_ROOT: '/tmp/x', REAL_PRODUCTION_INPUT: 'x', RENDER_MODE: 'FAST',
    FAST_RENDERER: 'moneyprinterturbo', MPT_ENABLED: 'true', MPT_BASE_URL: 'http://127.0.0.1:8080' }, input),
  (error) => error.code === 'FAST_PUBLICATION_GATE_REQUIRED');
  console.log('V2.6 FAST production input and configuration contract passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
