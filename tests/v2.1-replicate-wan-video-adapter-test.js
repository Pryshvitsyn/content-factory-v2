'use strict';

const assert = require('node:assert/strict');
const { ReplicateWanVideoAdapter, buildWanInput } = require('../src/providers/replicate-wan-video-adapter');

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload) };
}

function media(bytes = 'mock-mp4', status = 200) {
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => Uint8Array.from(Buffer.from(bytes)).buffer };
}

function clock() {
  let current = 0;
  return { now: () => current, sleep: async (milliseconds) => { current += milliseconds; } };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
}

async function main() {
  assert.deepEqual(buildWanInput({ prompt: 'vertical launch' }), {
    prompt: 'vertical launch', go_fast: true, num_frames: 81, resolution: '720p',
    aspect_ratio: '9:16', sample_shift: 12, frames_per_second: 16,
  });
  assert.throws(() => buildWanInput({ prompt: 'x', resolution: '1080p' }), (error) => error.code === 'REPLICATE_INPUT_INVALID');

  const lifecycleCalls = [];
  const durableBoundaries = [];
  const states = [
    { id: 'prediction-1', status: 'starting' },
    { id: 'prediction-1', status: 'processing' },
    { id: 'prediction-1', status: 'succeeded', output: 'https://files.replicate.test/video.mp4', metrics: { predict_time: 4.2 } },
  ];
  const lifecycleClock = clock();
  const adapter = new ReplicateWanVideoAdapter({
    apiToken: 'test-token', pollIntervalMs: 10, timeoutMs: 100, maxHttpRetries: 1,
    now: lifecycleClock.now, sleep: lifecycleClock.sleep,
    fetchImpl: async (url, options) => {
      lifecycleCalls.push({ url, options });
      if (options.method === 'POST') return json({ id: 'prediction-1', status: 'queued' });
      if (url.includes('/predictions/prediction-1')) return json(states.shift());
      return media('real-mock-mp4');
    },
  });
  const result = await adapter.generate({
    capability: 'video-generation',
    idempotencyKey: 'brand-a:production-1:media:video-1',
    onProviderRequest: async (request) => durableBoundaries.push(request),
    prompt: JSON.stringify({
      description: 'fallback description',
      generation_requirements: {
        prompt: 'cinematic product reveal', negative_prompt: 'blur', resolution: '480p',
        aspect_ratio: '9:16', num_frames: 121, frames_per_second: 30, go_fast: false, seed: 0,
      },
    }),
  });
  const createCall = lifecycleCalls[0];
  const body = JSON.parse(createCall.options.body);
  assert.equal(createCall.url, 'https://api.replicate.com/v1/models/wan-video/wan-2.2-t2v-fast/predictions');
  assert.equal(createCall.options.headers.Authorization, 'Bearer test-token');
  assert.equal(createCall.options.headers['Cancel-After'], '5s');
  assert.deepEqual(body.input, {
    prompt: 'cinematic product reveal', go_fast: false, num_frames: 121, resolution: '480p',
    aspect_ratio: '9:16', sample_shift: 12, frames_per_second: 30, seed: 0,
  });
  assert.equal('negative_prompt' in body.input, false);
  assert.equal(result.provider, 'replicate');
  assert.equal(result.model, 'wan-video/wan-2.2-t2v-fast');
  assert.equal(result.capability, 'video-generation');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.output.toString(), 'real-mock-mp4');
  assert.equal(result.requestId, 'prediction-1');
  assert.equal(result.provenance.predictionId, 'prediction-1');
  assert.equal(result.provenance.idempotencyKey, 'brand-a:production-1:media:video-1');
  assert.deepEqual(result.usage, { predict_time: 4.2 });
  assert.deepEqual(durableBoundaries, [{ requestId: 'prediction-1', status: 'queued', provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast' }]);
  assert.equal(JSON.stringify(result).includes('test-token'), false);

  const terminalAdapter = (prediction, extra = {}) => new ReplicateWanVideoAdapter({
    apiToken: 'test-token', pollIntervalMs: 1, timeoutMs: 5, maxHttpRetries: 0,
    ...clock(), ...extra,
    fetchImpl: extra.fetchImpl || (async () => json(prediction)),
  });
  await expectCode(terminalAdapter({ id: 'failed-1', status: 'failed', error: 'model error' }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_PREDICTION_FAILED');
  await expectCode(terminalAdapter({ id: 'cancel-1', status: 'canceled' }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_PREDICTION_CANCELED');
  await expectCode(terminalAdapter({ id: 'aborted-1', status: 'aborted' }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_PREDICTION_CANCELED');
  await expectCode(terminalAdapter({ id: 'missing-1', status: 'succeeded' }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_OUTPUT_MISSING');
  await expectCode(terminalAdapter('not-json').generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_MALFORMED_RESPONSE');
  await expectCode(terminalAdapter({ status: 'starting' }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_MALFORMED_RESPONSE');

  const timeoutClock = clock();
  await expectCode(new ReplicateWanVideoAdapter({
    apiToken: 'test-token', pollIntervalMs: 2, timeoutMs: 4, maxHttpRetries: 0,
    now: timeoutClock.now, sleep: timeoutClock.sleep,
    fetchImpl: async () => json({ id: 'slow-1', status: 'processing' }),
  }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_TIMEOUT');

  await expectCode(new ReplicateWanVideoAdapter({
    apiToken: 'test-token', maxHttpRetries: 0,
    fetchImpl: async (url, options) => options.method === 'POST'
      ? json({ id: 'download-1', status: 'succeeded', output: 'https://files.replicate.test/fail.mp4' })
      : media('', 502),
  }).generate({ capability: 'video-generation', prompt: 'x' }), 'REPLICATE_DOWNLOAD_FAILED');

  let pollingGets = 0;
  const retryClock = clock();
  const retried = await new ReplicateWanVideoAdapter({
    apiToken: 'test-token', pollIntervalMs: 1, timeoutMs: 20, maxHttpRetries: 1,
    now: retryClock.now, sleep: retryClock.sleep,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') return json({ id: 'retry-1', status: 'processing' });
      if (url.includes('/predictions/')) {
        pollingGets += 1;
        if (pollingGets === 1) return json({ detail: 'temporary' }, 503);
        return json({ id: 'retry-1', status: 'succeeded', output: 'https://files.replicate.test/retry.mp4' });
      }
      return media('retry-mp4');
    },
  }).generate({ capability: 'video-generation', prompt: 'x' });
  assert.equal(retried.output.toString(), 'retry-mp4');
  assert.equal(pollingGets, 2);

  let recoveryPosts = 0;
  const recovered = await new ReplicateWanVideoAdapter({
    apiToken: 'test-token', maxHttpRetries: 0,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') recoveryPosts += 1;
      if (url.includes('/predictions/existing-1')) return json({ id: 'existing-1', status: 'succeeded', output: 'https://files.replicate.test/existing.mp4' });
      return media('recovered-mp4');
    },
  }).recover({ capability: 'video-generation', requestId: 'existing-1' });
  assert.equal(recovered.output.toString(), 'recovered-mp4');
  assert.equal(recoveryPosts, 0, 'recovery must never create another paid prediction');

  let creates = 0;
  const duplicateAdapter = new ReplicateWanVideoAdapter({
    apiToken: 'test-token', maxHttpRetries: 0,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { creates += 1; return json({ id: 'dedupe-1', status: 'succeeded', output: 'https://files.replicate.test/dedupe.mp4' }); }
      return media('dedupe-mp4');
    },
  });
  const [first, second] = await Promise.all([
    duplicateAdapter.generate({ capability: 'video-generation', prompt: 'same', idempotencyKey: 'same-operation' }),
    duplicateAdapter.generate({ capability: 'video-generation', prompt: 'same', idempotencyKey: 'same-operation' }),
  ]);
  assert.equal(creates, 1);
  assert.equal(first.requestId, second.requestId);

  let releaseCreation;
  const heldCreation = new Promise((resolve) => { releaseCreation = resolve; });
  const conflictAdapter = new ReplicateWanVideoAdapter({
    apiToken: 'test-token', maxHttpRetries: 0,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') { await heldCreation; return json({ id: 'conflict-1', status: 'succeeded', output: 'https://files.replicate.test/conflict.mp4' }); }
      return media('conflict-mp4');
    },
  });
  const held = conflictAdapter.generate({ capability: 'video-generation', prompt: 'first input', idempotencyKey: 'conflicting-operation' });
  await expectCode(conflictAdapter.generate({ capability: 'video-generation', prompt: 'different input', idempotencyKey: 'conflicting-operation' }), 'REPLICATE_IDEMPOTENCY_CONFLICT');
  releaseCreation();
  await held;
  console.log('v2.1 Replicate Wan video adapter certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
