'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCanonicalMediaRequest } = require('../src/v2.8/canonical-media-request');
const compiler = require('../src/v2.8/provider-request-compiler');
const { ReplicateUniversalVideoAdapter } = require('../src/providers/replicate-universal-video-adapter');
const { planReplicateFiles, prepareReplicateFiles, INLINE_LIMIT, redactTransportError } = require('../src/providers/replicate-file-transport');
const { rejectedBeforeCreation, terminalProviderFailure } = require('../src/providers/execution-outcome');
const { generateMediaAsset } = require('../worker/v2.1-media-generation');
const { QualityRendererLane } = require('../src/v2.6/renderer-router');
const sha = value => createHash('sha256').update(value).digest('hex');
// Synthetic opaque bytes: transport must not decode/re-encode image pixels.
// Geometry decoding is independently covered by the reference materializer tests.
const bytes = Buffer.alloc(Math.ceil(2.98 * 1024 * 1024), 42);
const uri = `data:image/png;base64,${bytes.toString('base64')}`;
const now = Date.parse('2026-11-08T12:00:00Z');
const download = 'https://api.replicate.com/v1/files/file-1/download?expiry=1794225600&signature=synthetic-secret';
const req = (extra = {}) => createCanonicalMediaRequest({ capability: 'IMAGE_TO_VIDEO', prompt: 'She sets down the bag.',
  providerPrompt: 'She sets down the bag.', providerSelection: { provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD' },
  resolution: '720p', aspectRatio: '9:16', durationSeconds: 5, references: { firstFrame: uri },
  referenceGeometry: { referenceWidth: 720, referenceHeight: 1280, referenceAspectRatio: 0.5625,
    expectedAspectRatio: '9:16', referenceHash: sha(bytes) }, ...extra });
const receipt = (extra = {}) => ({ id: 'file-1', size: bytes.length, content_type: 'image/png', checksums: { sha256: sha(bytes) },
  expires_at: '2026-11-09T12:00:00Z', urls: { get: download }, ...extra });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let groups = 0;
async function check(name, fn) { await fn(); groups++; console.log(`PASS ${name}`); }
function harness({ upload = receipt(), uploadStatus = 200, postFailure = null, terminal = false, persistFailure = null } = {}) {
  const events = [], evidence = [], calls = [];
  const adapter = new ReplicateUniversalVideoAdapter({ family: 'WAN_3', model: 'alibaba/wan-3', apiToken: 'synthetic',
    now: () => now, maxHttpRetries: 0, pollIntervalMs: 1, sleep: async () => {}, fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/files')) {
        events.push('upload');
        assert(options.body instanceof FormData);
        const content = options.body.get('content');
        assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
        assert.equal(content.type, 'image/png');
        assert.equal(options.headers['Content-Type'], undefined, 'fetch must supply the multipart boundary');
        assert.equal(options.redirect, 'error');
        return response(upload, uploadStatus);
      }
      if (options.method === 'POST') {
        events.push('prediction');
        if (postFailure) throw postFailure;
        return response({ id: 'prediction-1', status: terminal ? 'failed' : 'succeeded', error: terminal ? 'E005 privacy refusal' : null,
          output: 'https://replicate.delivery/output.mp4' });
      }
      events.push('download');
      return new Response(Buffer.from('synthetic-video'));
    } });
  const options = { canonicalRequest: req(), idempotencyKey: 'brand-A:production-A:video-1',
    onProviderRequestEvidence: async value => { events.push(value.phase); if (persistFailure === value.phase) throw Error('journal unavailable'); evidence.push(value); },
    onProviderRequest: async value => { events.push(`accepted:${value.requestId}`); } };
  return { adapter, options, events, evidence, calls };
}
async function main() {
  await check('large exact image plans upload with no network; small images and T2V stay inline', async () => {
    const c = compiler.compileVideoRequest(req());
    assert.equal(c.transportPlan.uploadCalls, 1); assert.equal(c.transportPlan.networkCallsMade, 0);
    assert.equal(c.transportPlan.files[0].sha256, sha(bytes)); assert.equal(c.payload.input.image, uri);
    assert.equal(planReplicateFiles({ image: `data:image/png;base64,${Buffer.alloc(INLINE_LIMIT).toString('base64')}` }).uploadCalls, 0);
    assert.equal(planReplicateFiles({ prompt: 'hi' }).uploadCalls, 0);
    assert.throws(() => planReplicateFiles({ image: 'data:image/png;base64,!!!!' }), { code: 'REFERENCE_ENCODING_INVALID' });
  });
  await check('multipart preserves every byte; wire certificate and file receipt precede prediction; concurrent Start deduplicates', async () => {
    const h = harness(); const c = compiler.compileVideoRequest(h.options.canonicalRequest);
    h.options.canonicalRequest = { ...h.options.canonicalRequest, expectedProviderRequest: c.summary };
    const [result, same] = await Promise.all([h.adapter.generate(h.options), h.adapter.generate(h.options)]);
    assert.equal(result.requestId, same.requestId);
    assert.deepEqual(h.events, ['UPLOAD_REQUESTED', 'upload', 'UPLOAD_VERIFIED', 'PREDICTION_PREPARED', 'prediction', 'accepted:prediction-1', 'download']);
    const post = h.calls.find(call => call.options.method === 'POST' && call.url.endsWith('/predictions'));
    assert.deepEqual(JSON.parse(post.options.body), { input: { ...c.payload.input, image: download } });
    assert.equal(h.evidence.at(-1).wirePayloadSha256, sha(post.options.body));
    assert.equal(result.provenance.providerRequestTransport.canonicalFingerprint, c.fingerprint);
    assert.equal(result.provenance.providerRequestTransport.uploadCalls, 1);
    assert(!JSON.stringify(result.provenance).includes('synthetic-secret'));
    assert(!JSON.stringify(h.evidence).includes('base64,'));
    assert.equal(h.options.canonicalRequest.references.firstFrame, uri);
  });
  await check('all sibling shots get upload estimates; deferred frames reserve an upload', async () => {
    const assets = Array.from({ length: 4 }, (_, i) => ({ asset_id: `video-${i+1}`, kind: 'video', description: 'Quiet kitchen.', generation_requirements: {
      provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD', capability: 'IMAGE_TO_VIDEO', resolution: '720p', aspect_ratio: '9:16',
      target_clip_duration_ms: 5000, prompt: 'Quiet kitchen.', prompt_compiler_version: 'shot/4', v210_reference: { policy: 'PREVIOUS_SHOT_FRAME' } } }));
    const checks = compiler.collectProviderPreflight(assets);
    assert(checks.every(c => c.status === 'DEFERRED_REFERENCE' && c.referenceUploadMaximum === 1));
    const lane = new QualityRendererLane({ masterOrchestrator: { build() {} } });
    const plan = lane.plan({ input: { assetPlan: { assets }, profile: {} }, config: {}, laneState: { executions: [], providerRequests: checks } });
    assert.equal(plan.expectedReferenceUploadCalls, 4);
    const cached = lane.plan({ input: { assetPlan: { assets }, profile: {} }, config: {}, laneState: { executions: [{ status: 'SUCCEEDED', asset_id: 'video-1' }], providerRequests: checks } });
    assert.equal(cached.expectedReferenceUploadCalls, 3);
  });
  await check('stale certificate or changed original frame is rejected before upload', async () => {
    const h = harness(), c = compiler.compileVideoRequest(req());
    await assert.rejects(() => h.adapter.generate({ ...h.options, canonicalRequest: { ...req(), expectedProviderRequest: { ...c.summary, compilerVersion: 'provider-request/5' } } }), { code: 'STALE_PROVIDER_PREFLIGHT' });
    await assert.rejects(() => h.adapter.generate({ ...h.options, canonicalRequest: req({ references: { firstFrame: 'data:image/png;base64,Yg==' } }) }), { code: 'REFERENCE_GEOMETRY_MISMATCH' });
    assert.equal(h.calls.length, 0);
  });
  await check('missing durable journal blocks upload and paid POST', async () => {
    const h = harness(); await assert.rejects(() => h.adapter.generate({ ...h.options, onProviderRequestEvidence: null }), { code: 'REFERENCE_TRANSPORT_JOURNAL_REQUIRED' });
    assert.equal(h.calls.length, 0);
  });
  for (const [name, upload] of [
    ['wrong hash', receipt({ checksums: { sha256: 'bad' } })], ['wrong size', receipt({ size: 2 })],
    ['wrong MIME', receipt({ content_type: 'image/jpeg' })], ['expired', receipt({ expires_at: '2026-11-08T12:00:01Z' })],
    ['missing expiry', receipt({ expires_at: undefined })], ['foreign host', receipt({ urls: { get: 'https://untrusted.example/image.png' } })],
    ['wrong file ID in URL', receipt({ urls: { get: 'https://api.replicate.com/v1/files/other' } })],
  ]) await check(`upload ${name} stops before prediction`, async () => {
    const h = harness({ upload }); await assert.rejects(() => h.adapter.generate(h.options), error => rejectedBeforeCreation(error));
    assert.equal(h.calls.length, 1);
  });
  await check('upload rejection never retries or falls back to data URI', async () => {
    const h = harness({ uploadStatus: 503 }); await assert.rejects(() => h.adapter.generate(h.options), error => rejectedBeforeCreation(error) && error.details.transport.uploadCalls === 1);
    assert.equal(h.calls.length, 1);
  });
  await check('failed receipt or wire-certificate persistence never submits prediction', async () => {
    for (const phase of ['UPLOAD_REQUESTED', 'UPLOAD_VERIFIED', 'PREDICTION_PREPARED']) {
      const h = harness({ persistFailure: phase }); await assert.rejects(() => h.adapter.generate(h.options), error => rejectedBeforeCreation(error));
      assert.equal(h.calls.length, phase === 'UPLOAD_REQUESTED' ? 0 : 1);
    }
  });
  await check('upload timeout leaves file uncertainty but proves no prediction POST', async () => {
    const c = compiler.compileVideoRequest(req()); let calls = 0;
    await assert.rejects(() => prepareReplicateFiles({ input: c.payload.input, plan: c.transportPlan, canonicalFingerprint: c.fingerprint,
      endpoint: c.target, apiToken: 'synthetic', timeoutMs: 5, now: () => now, onEvidence: async () => {},
      fetchImpl: async (_, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout')))); } }),
    error => rejectedBeforeCreation(error) && error.details.transport.uploadCalls === 1);
    assert.equal(calls, 1);
  });
  await check('prediction network ambiguity retains upload evidence and never becomes safe-to-retry', async () => {
    const h = harness({ postFailure: Error('lost after POST') });
    await assert.rejects(() => h.adapter.generate(h.options), error => !rejectedBeforeCreation(error) && error.details.transport.files[0].fileId === 'file-1');
    assert.equal(h.calls.length, 2);
  });
  await check('accepted moderation failure retains prediction ID and transport without retry', async () => {
    const h = harness({ terminal: true }); await assert.rejects(() => h.adapter.generate(h.options), error => terminalProviderFailure(error)
      && error.predictionId === 'prediction-1' && error.details.transport.files.length === 1);
    assert(h.events.includes('accepted:prediction-1')); assert.equal(h.calls.length, 2);
  });
  await check('official null-expiry file receipt is accepted; no credentials in provenance', async () => {
    const h = harness({ upload: receipt({ expires_at: null, urls: { get: 'https://api.replicate.com/v1/files/file-1' } }) });
    const result = await h.adapter.generate(h.options); assert.equal(result.provenance.providerRequestTransport.files[0].expiresAt, null);
  });
  await check('provider error echoes cannot leak uploaded file credentials', async () => {
    const c = compiler.compileVideoRequest(req());
    const error = Object.assign(new Error(`bad image ${download}`), { cause: { detail: download }, details: { nested: [download] } });
    redactTransportError(error, { image: download }, c.transportPlan);
    assert(!JSON.stringify(error).includes('synthetic-secret')); assert(!error.stack.includes('synthetic-secret'));
  });
  await check('expiry is checked again after delayed journal persistence', async () => {
    const c = compiler.compileVideoRequest(req()); let clock = now;
    await assert.rejects(() => prepareReplicateFiles({ input: c.payload.input, plan: c.transportPlan, canonicalFingerprint: c.fingerprint,
      endpoint: c.target, apiToken: 'synthetic', now: () => clock, fetchImpl: async () => response(receipt()),
      onEvidence: async value => { if (value.phase === 'PREDICTION_PREPARED') clock += 2 * 86400000; } }),
    error => error.code === 'REFERENCE_UPLOAD_EXPIRED' && rejectedBeforeCreation(error));
  });
  await check('legacy media worker forwards durable transport callback without changing route identity', async () => {
    const callback = async () => {};
    await assert.rejects(() => generateMediaAsset({ asset: { asset_id: 'video-1', kind: 'video', generation_requirements: {} }, productionId: 'P', brandId: 'B', workerId: 'W',
      onProviderRequestEvidence: callback, providerGateway: { generate: async options => { assert.equal(options.onProviderRequestEvidence, callback);
        assert.equal(options.idempotencyKey, 'B:P:media:video-1'); throw Error('mock stop'); } } }), /mock stop/);
  });
  console.log(`${groups} file transport groups passed. Real uploads: 0. Real generation calls: 0.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
