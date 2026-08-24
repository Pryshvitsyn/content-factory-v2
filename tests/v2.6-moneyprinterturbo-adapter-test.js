'use strict';

const assert = require('node:assert/strict');
const { MoneyPrinterTurboAdapter, normalizeMptRequest } = require('../src/v2.6/moneyprinterturbo-adapter');

function config(overrides = {}) {
  return { enabled: true, baseUrl: 'http://127.0.0.1:8080', version: 'v1.3.3', apiKey: null,
    requestTimeoutMs: 25, pollIntervalMs: 1, maxWaitMs: 1000, maxOutputBytes: 1024, healthcheck: true, ...overrides };
}

function request() {
  return { production: { title: 'A human moment' }, script: { hook: 'Notice' },
    scenes: [{ dialogue_or_voiceover: 'Notice before you assume.' }],
    voiceover: { text: 'Notice before you assume.', language: 'en', voice: 'en-US-AvaNeural-Female' },
    captions: { enabled: true }, mediaPreferences: { mediaSource: 'pexels', music: true,
      providerOptions: { clip_duration_seconds: 4, concat_mode: 'sequential', bgm_volume: 0.1 } },
    outputProfile: { aspectRatio: '9:16', width: 1080, height: 1920 } };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

async function main() {
  const normalized = normalizeMptRequest(request());
  assert.equal(normalized.video_subject, 'A human moment');
  assert.equal(normalized.video_script, 'Notice before you assume.');
  assert.equal(normalized.video_source, 'pexels');
  assert.equal(normalized.video_aspect, '9:16');
  assert.equal(normalized.subtitle_enabled, true);
  assert.equal(normalized.video_count, 1);
  assert.equal(new MoneyPrinterTurboAdapter({ config: config(), fetchImpl: async () => null }).validate(request()).output.captions, true);
  assert.throws(() => normalizeMptRequest({ ...request(), outputProfile: { aspectRatio: '16:9' } }),
    (error) => error.code === 'MPT_REQUEST_INVALID');
  assert.throws(() => normalizeMptRequest({ ...request(), mediaPreferences: {
    ...request().mediaPreferences, providerOptions: { clip_duration_seconds: 0 } } }),
  (error) => error.code === 'MPT_REQUEST_INVALID');

  const calls = []; let polls = 0; let accepted = null; let statuses = 0;
  const adapter = new MoneyPrinterTurboAdapter({ config: config(), sleep: async () => {}, fetchImpl: async (url, options) => {
    calls.push([String(url), options.method]);
    if (url.pathname === '/openapi.json') return new Response('{}', { status: 200 });
    if (url.pathname === '/api/v1/videos') {
      assert.equal(JSON.parse(options.body).video_source, 'pexels');
      return json({ status: 200, message: 'success', data: { task_id: 'task-1' } });
    }
    if (url.pathname === '/api/v1/tasks/task-1') {
      polls += 1;
      return json({ status: 200, message: 'success', data: polls === 1
        ? { task_id: 'task-1', state: 4, progress: 50 }
        : { task_id: 'task-1', state: 1, progress: 100, videos: ['/tasks/task-1/final.mp4'] } });
    }
    if (url.pathname === '/tasks/task-1/final.mp4') return new Response(Buffer.from('mock-mp4'), {
      status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '8' },
    });
    throw new Error(`Unexpected URL ${url}`);
  } });
  assert.equal((await adapter.health()).availability, 'AVAILABLE');
  const rendered = await adapter.render(request(), { onAccepted: (value) => { accepted = value; }, onStatus: () => { statuses += 1; } });
  assert.equal(accepted.requestId, 'task-1'); assert.equal(rendered.requestId, 'task-1');
  assert.equal(rendered.output.toString(), 'mock-mp4'); assert.equal(rendered.provenance.cost.status, 'unknown');
  assert.equal(polls, 2); assert.equal(statuses, 2); assert.equal(calls.filter(([url]) => url.endsWith('/api/v1/videos')).length, 1);

  const malformed = new MoneyPrinterTurboAdapter({ config: config(), fetchImpl: async () => json({ status: 200, data: {} }) });
  await assert.rejects(() => malformed.render(request()), (error) => error.code === 'MPT_RESPONSE_INVALID');
  const serviceError = new MoneyPrinterTurboAdapter({ config: config(), fetchImpl: async () => new Response('bad', { status: 503 }) });
  await assert.rejects(() => serviceError.render(request()), (error) => error.code === 'MPT_SERVICE_ERROR');
  const timeout = new MoneyPrinterTurboAdapter({ config: config({ requestTimeoutMs: 5 }), fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) });
  await assert.rejects(() => timeout.health().then((health) => {
    if (health.availability === 'UNAVAILABLE') throw Object.assign(new Error('timeout mapped'), { code: health.errorCode });
  }), (error) => error.code === 'MPT_REQUEST_TIMEOUT');
  assert.throws(() => adapter.outputUrl('https://example.com/tasks/stolen.mp4'), (error) => error.code === 'MPT_OUTPUT_URL_REJECTED');
  assert.throws(() => adapter.outputUrl('/tasks/../secret'), (error) => error.code === 'MPT_OUTPUT_URL_REJECTED');

  const publishing = new MoneyPrinterTurboAdapter({ config: config(), fetchImpl: async () => json({ status: 200, data: {
    task_id: 'task-publish', state: 1, videos: ['/tasks/task-publish/final.mp4'], cross_post_state: 'pending',
  } }) });
  await assert.rejects(() => publishing.recover({ requestId: 'task-publish', request: request() }),
    (error) => error.code === 'MPT_PUBLICATION_POLICY_VIOLATION');

  let recoverPosts = 0;
  const recover = new MoneyPrinterTurboAdapter({ config: config(), sleep: async () => {}, fetchImpl: async (url, options) => {
    if (options.method === 'POST') recoverPosts += 1;
    if (url.pathname === '/api/v1/tasks/task-existing') return json({ status: 200, data: {
      task_id: 'task-existing', state: 1, videos: ['/tasks/task-existing/final.mp4'],
    } });
    if (url.pathname === '/tasks/task-existing/final.mp4') return new Response(Buffer.from('recovered'), {
      status: 200, headers: { 'content-type': 'video/mp4' },
    });
    throw new Error(`Unexpected URL ${url}`);
  } });
  assert.equal((await recover.recover({ requestId: 'task-existing', request: request() })).requestId, 'task-existing');
  assert.equal(recoverPosts, 0, 'recovery must poll the durable task instead of submitting another');
  console.log('V2.6 MoneyPrinterTurbo HTTP adapter contract passed (mock service only).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
