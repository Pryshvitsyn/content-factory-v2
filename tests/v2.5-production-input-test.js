'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertPaidCredentials, resolveV25Configuration } = require('../src/v2.5/configuration');
const { buildProductionInput } = require('../src/v2.5/production-input');

function raw() {
  return JSON.parse(fs.readFileSync(path.resolve('config/productions/attune-dont-guess-tune-in.json'), 'utf8'));
}

function env(overrides = {}) {
  return { LIVE_PAID_GENERATION: 'false', VIDEO_PROVIDER: 'replicate', AUDIO_PROVIDER: 'openai-media',
    DATABASE_URL: 'postgresql://plan-only', CONTENT_FACTORY_STORAGE_ROOT: '/tmp/cf-v25',
    REAL_PRODUCTION_INPUT: '/tmp/input.json', ...overrides };
}

function main() {
  const input = buildProductionInput(raw());
  assert.equal(input.schemaVersion, 2);
  assert.equal(input.brandId, 'a03def76-bd3d-4c8e-b00a-ec77616c5191');
  assert.equal(input.productionKey, 'attune-dont-guess-tune-in-20260824-v1');
  assert.notEqual(input.productionKey, 'v2.4-first-real-e2e');
  assert.equal(input.targetDurationSeconds, 10);
  assert.deepEqual(input.shotPlan.shots.map((shot) => shot.duration_seconds), [3, 4, 3]);
  assert.equal(input.assetPlan.assets.filter((asset) => asset.kind === 'video').length, 3);
  assert.equal(input.assetPlan.assets.filter((asset) => asset.kind === 'voice').length, 1);
  assert.equal(input.assetPlan.assets.length, 4);
  assert.ok(input.assetPlan.assets.every((asset) => asset.required_for_shots.length > 0));
  assert.equal(input.publicationPolicy.requiresHumanApproval, true);
  assert.equal(input.publicationPolicy.autoPublish, false);
  assert.match(input.assetPlan.assets[0].generation_requirements.prompt, /Character continuity/);
  assert.equal(buildProductionInput(raw()).fingerprint, input.fingerprint, 'operator input must normalize deterministically');

  const badDuration = raw(); badDuration.scenes[1].duration_seconds = 5;
  assert.throws(() => buildProductionInput(badDuration), /shot durations must equal scene duration/);
  const unsafePolicy = raw(); unsafePolicy.publication_policy.auto_publish = true;
  assert.throws(() => buildProductionInput(unsafePolicy), /auto_publish must be false/);

  const dryConfig = resolveV25Configuration(env());
  assert.equal(dryConfig.live, false);
  assert.doesNotThrow(() => assertPaidCredentials({ config: dryConfig, input, env: env() }),
    'dry-run must not require real provider credentials');
  const paidConfig = resolveV25Configuration(env({ LIVE_PAID_GENERATION: 'true' }));
  assert.throws(() => assertPaidCredentials({ config: paidConfig, input, env: env({ LIVE_PAID_GENERATION: 'true' }) }),
    (error) => error.code === 'LIVE_REPLICATE_TOKEN_REQUIRED');
  assert.throws(() => resolveV25Configuration(env({ LIVE_PAID_GENERATION: undefined })),
    (error) => error.code === 'LIVE_PAID_GATE_REQUIRED');
  console.log('V2.5 reusable production input and 10-second planning contract passed.');
}

main();
