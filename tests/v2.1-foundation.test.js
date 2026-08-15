const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const contracts = require('../worker/v2.1-contracts');

const migrationPath = path.join(__dirname, '..', 'migrations', '20260815_v2_1_foundation.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('foundation migration is present and isolated in v2_1 schema', () => {
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS v2_1/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS v2_1\.projects/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS v2_1\.jobs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS v2_1\.artifacts/);
});

test('foundation migration contains idempotency and provenance constraints', () => {
  assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(migration, /request_hash text NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS v2_1\.artifact_versions/);
  assert.match(migration, /provider_id uuid REFERENCES v2_1\.providers/);
  assert.match(migration, /model_id uuid REFERENCES v2_1\.models/);
});

test('stage contract contains the complete V2.1 production loop', () => {
  assert.deepEqual(contracts.STAGES, [
    'SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT', 'BIBLE',
    'ASSET_PLAN', 'SHOT_PLAN', 'ASSET_GENERATION', 'CONTINUITY',
    'EDIT', 'PLATFORM_ADAPTATION', 'VALIDATION', 'PUBLISH', 'ANALYZE', 'LEARN',
  ]);
});

test('terminal states cannot transition back into work', () => {
  assert.equal(contracts.canTransition('COMPLETED', 'RUNNING'), false);
  assert.equal(contracts.canTransition('CANCELLED', 'RUNNING'), false);
  assert.equal(contracts.canTransition('FAILED', 'RETRYING'), true);
  assert.equal(contracts.canTransition('RETRYING', 'RUNNING'), true);
});

test('idempotency keys are deterministic for identical requests', () => {
  const input = {
    stage: 'ASSET_GENERATION',
    inputHash: 'abc123',
    promptVersion: 'image_prompt_v1',
    provider: 'NVIDIA',
    model: 'image-model',
    parameters: { width: 1080, height: 1920 },
  };
  const a = contracts.buildIdempotencyKey(input);
  const b = contracts.buildIdempotencyKey({ ...input, parameters: { height: 1920, width: 1080 } });
  assert.equal(a, b);
});

test('generation request is provider-neutral', () => {
  const request = contracts.createGenerationRequest({
    capability: 'IMAGE',
    model: 'example-image-model',
    prompt: 'A cinematic close-up',
    referenceAssets: ['asset_123'],
    parameters: { aspectRatio: '9:16' },
  });
  assert.equal(request.capability, 'IMAGE');
  assert.equal(request.referenceAssets[0], 'asset_123');
  assert.equal(request.parameters.aspectRatio, '9:16');
});

test('stage runs start queued and require a valid stage', () => {
  const run = contracts.createStageRun({ jobId: 'job_1', stage: 'SCRIPT' });
  assert.deepEqual(run, { jobId: 'job_1', stage: 'SCRIPT', attempt: 1, status: 'QUEUED' });
  assert.throws(() => contracts.createStageRun({ jobId: 'job_1', stage: 'NOPE' }), /stage must be one of/);
});

test('provider capabilities are explicit', () => {
  for (const capability of ['TEXT', 'IMAGE', 'VIDEO', 'VOICE', 'AUDIO', 'MUSIC', 'VISION', 'TRANSCRIPTION', 'EMBEDDING']) {
    assert.doesNotThrow(() => contracts.assertCapability(capability));
  }
});

console.log('V2.1 FOUNDATION TESTS PASSED.');
