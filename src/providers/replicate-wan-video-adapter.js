'use strict';

const { ProviderError, assertProviderResult } = require('./provider-contract');
const crypto = require('node:crypto');

const DEFAULT_MODEL = 'wan-video/wan-2.2-t2v-fast';
const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';
const PENDING_STATUSES = new Set(['queued', 'starting', 'processing']);
const CANCELED_STATUSES = new Set(['canceled', 'aborted']);
const FILE_EXPIRY_SAFETY_MS = 30 * 1000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerError(message, code, { model = DEFAULT_MODEL, cause, predictionId } = {}) {
  const error = new ProviderError(message, { provider: 'replicate', model, cause });
  error.code = code;
  error.predictionId = predictionId || null;
  return error;
}

function parseGenerationPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw providerError('Replicate video generation requires a prompt', 'REPLICATE_PROMPT_REQUIRED');
  }
  try {
    const parsed = JSON.parse(prompt);
    return {
      prompt: parsed.generation_requirements?.prompt || parsed.description || prompt,
      requirements: parsed.generation_requirements || {},
    };
  } catch {
    return { prompt, requirements: {} };
  }
}

function integerInRange(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw providerError(`${name} must be an integer between ${minimum} and ${maximum}`, 'REPLICATE_INPUT_INVALID');
  }
  return value;
}

function buildWanInput({
  prompt,
  resolution = '720p',
  aspectRatio = '9:16',
  numFrames = 81,
  framesPerSecond = 16,
  goFast = true,
  seed,
  sampleShift = 12,
  optimizePrompt,
  interpolateOutput,
} = {}) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    throw providerError('Replicate video generation requires a prompt', 'REPLICATE_PROMPT_REQUIRED');
  }
  if (!['480p', '720p'].includes(resolution)) {
    throw providerError('resolution must be 480p or 720p', 'REPLICATE_INPUT_INVALID');
  }
  if (!/^\d+:\d+$/.test(aspectRatio)) throw providerError('aspectRatio must be a ratio such as 9:16', 'REPLICATE_INPUT_INVALID');
  integerInRange('numFrames', numFrames, 81, 121);
  integerInRange('framesPerSecond', framesPerSecond, 5, 30);
  if (!Number.isFinite(sampleShift) || sampleShift < 1 || sampleShift > 20) {
    throw providerError('sampleShift must be between 1 and 20', 'REPLICATE_INPUT_INVALID');
  }
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
    throw providerError('seed must be a non-negative integer', 'REPLICATE_INPUT_INVALID');
  }

  return {
    prompt: prompt.trim(),
    go_fast: Boolean(goFast),
    num_frames: numFrames,
    resolution,
    aspect_ratio: aspectRatio,
    sample_shift: sampleShift,
    frames_per_second: framesPerSecond,
    ...(seed !== undefined ? { seed } : {}),
    ...(optimizePrompt !== undefined ? { optimize_prompt: Boolean(optimizePrompt) } : {}),
    ...(interpolateOutput !== undefined ? { interpolate_output: Boolean(interpolateOutput) } : {}),
  };
}

function outputUrl(prediction) {
  const output = prediction?.output;
  if (typeof output === 'string' && output.length > 0) return output;
  if (Array.isArray(output) && typeof output[0] === 'string' && output[0].length > 0) return output[0];
  if (output && typeof output.url === 'string' && output.url.length > 0) return output.url;
  return null;
}
function mediaEvidence(value) {
  if (value?.__factoryProviderFile) return { kind: 'PROVIDER_FILE', byteSize: value.bytes?.length || null,
    sha256: value.sha256 || null, artifactId: value.artifactId || null, artifactVersion: value.artifactVersion || null,
    materializationMethod: 'REPLICATE_FILES_API' };
  if (Buffer.isBuffer(value)) return { kind: 'BUFFER', byteSize: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex') };
  const encoded = /^data:([^;,]+);base64,(.+)$/s.exec(String(value || ''));
  if (encoded) {
    const bytes = Buffer.from(encoded[2], 'base64');
    return { kind: 'DATA_URI', mimeType: encoded[1], byteSize: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  return { kind: 'REMOTE_REFERENCE', locatorHash: crypto.createHash('sha256').update(String(value || '')).digest('hex') };
}
function safeInputProvenance(input = {}) {
  const media = new Set(['image','last_frame_image','reference_images','reference_videos','reference_audios']);
  return Object.fromEntries(Object.entries(input).map(([name, value]) => [name,
    media.has(name) ? (Array.isArray(value) ? value.map(mediaEvidence) : mediaEvidence(value)) : value]));
}

class ReplicateWanVideoAdapter {
  constructor({
    apiToken = process.env.REPLICATE_API_TOKEN,
    model = DEFAULT_MODEL,
    baseURL = DEFAULT_BASE_URL,
    fetchImpl = global.fetch,
    pollIntervalMs = 2000,
    timeoutMs = 10 * 60 * 1000,
    maxHttpRetries = 2,
    sleep = wait,
    now = Date.now,
  } = {}) {
    if (!fetchImpl) throw new Error('Replicate video adapter requires fetch');
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw new Error('pollIntervalMs must be positive');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
    if (timeoutMs > 24 * 60 * 60 * 1000) throw new Error('timeoutMs must not exceed 24 hours');
    if (!Number.isInteger(maxHttpRetries) || maxHttpRetries < 0) throw new Error('maxHttpRetries must be a non-negative integer');
    this.apiToken = apiToken;
    this.model = model;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.maxHttpRetries = maxHttpRetries;
    this.sleep = sleep;
    this.now = now;
    this.inflight = new Map();
    this.fileMaterializations = new Map();
  }

  async uploadProviderFile(value) {
    if (!value?.__factoryProviderFile || !Buffer.isBuffer(value.bytes)) return value;
    if (value.bytes.length >= 100 * 1024 * 1024) throw providerError('Replicate Files API inputs must be less than 100MB', 'REPLICATE_FILE_TOO_LARGE', { model: this.model });
    const actualHash = crypto.createHash('sha256').update(value.bytes).digest('hex');
    if (value.sha256 && value.sha256 !== actualHash) throw providerError('Provider file bytes do not match immutable source hash', 'REPLICATE_FILE_HASH_MISMATCH', { model: this.model });
    const cacheKey = `${actualHash}:replicate-files-api@1`;
    if (this.fileMaterializations.has(cacheKey)) {
      const cached = await this.fileMaterializations.get(cacheKey);
      if (Number.isFinite(cached.cacheExpiresAt) && this.now() + FILE_EXPIRY_SAFETY_MS < cached.cacheExpiresAt) return cached;
      this.fileMaterializations.delete(cacheKey);
    }
    const operation = (async () => {
      if (!this.apiToken) throw providerError('REPLICATE_API_TOKEN is required for file upload', 'REPLICATE_TOKEN_REQUIRED', { model: this.model });
      const form = new FormData();
      const extension = String(value.mimeType || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
      form.append('content', new Blob([value.bytes], { type: value.mimeType || 'application/octet-stream' }), `factory-${actualHash.slice(0, 16)}.${extension}`);
      form.append('metadata', JSON.stringify({ source_sha256: actualHash, artifact_id: value.artifactId || null,
        artifact_version: value.artifactVersion || null, purpose: value.purpose || null }));
      const file = await this.requestJson(`${this.baseURL}/files`, { method: 'POST', headers: {
        Authorization: `Bearer ${this.apiToken}`, Accept: 'application/json' }, body: form });
      if (!file.id || !file.urls?.get || file.checksums?.sha256 !== actualHash) throw providerError('Replicate file upload returned invalid identity/checksum evidence', 'REPLICATE_FILE_UPLOAD_INVALID', { model: this.model });
      const cacheExpiresAt = Date.parse(file.expires_at || '');
      return Object.freeze({ locator: file.urls.get, cacheExpiresAt: Number.isFinite(cacheExpiresAt) ? cacheExpiresAt : null,
        evidence: Object.freeze({ provider: 'replicate', method: 'REPLICATE_FILES_API',
        materializationContractVersion: 'replicate-files-api@1', providerFileId: file.id, sourceSha256: actualHash,
        sourceMime: value.mimeType || 'application/octet-stream', sourceByteSize: value.bytes.length,
        artifactId: value.artifactId || null, artifactVersion: value.artifactVersion || null,
        locatorHash: crypto.createHash('sha256').update(file.urls.get).digest('hex'), expiresAt: file.expires_at || null }) });
    })();
    this.fileMaterializations.set(cacheKey, operation);
    try {
      const uploaded = await operation;
      if (!Number.isFinite(uploaded.cacheExpiresAt)) this.fileMaterializations.delete(cacheKey);
      return uploaded;
    } catch (error) { this.fileMaterializations.delete(cacheKey); throw error; }
  }

  async materializeInput(input) {
    const evidence = [];
    const visit = async (value) => {
      if (value?.__factoryProviderFile) { const uploaded = await this.uploadProviderFile(value); evidence.push(uploaded.evidence); return uploaded.locator; }
      if (Array.isArray(value)) return Promise.all(value.map(visit));
      if (value && typeof value === 'object') { const out = {}; for (const [key, child] of Object.entries(value)) out[key] = await visit(child); return out; }
      return value;
    };
    return { input: await visit(input), evidence: Object.freeze(evidence) };
  }

  supports({ capability, model } = {}) {
    return capability === 'video-generation' && (!model || model === this.model);
  }

  modelFor({ capability } = {}) {
    return capability === 'video-generation' ? this.model : null;
  }

  async healthCheck() {
    return Boolean(this.apiToken);
  }

  async requestJson(url, options, { retryable = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= (retryable ? this.maxHttpRetries : 0); attempt += 1) {
      let response;
      try {
        response = await this.fetch(url, options);
      } catch (cause) {
        lastError = providerError('Replicate request failed', 'REPLICATE_NETWORK_ERROR', { model: this.model, cause });
        if (attempt < this.maxHttpRetries && retryable) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw lastError;
      }

      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (cause) {
        throw providerError('Replicate returned malformed JSON', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model, cause });
      }
      if (!response.ok) {
        lastError = providerError(`Replicate request failed with HTTP ${response.status}: ${payload?.detail || payload?.error || 'unknown error'}`, 'REPLICATE_HTTP_ERROR', { model: this.model, cause: payload });
        if (retryable && (response.status === 429 || response.status >= 500) && attempt < this.maxHttpRetries) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw lastError;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw providerError('Replicate returned a malformed prediction', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model });
      }
      return payload;
    }
    throw lastError;
  }

  async downloadVideo(url, predictionId) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxHttpRetries; attempt += 1) {
      let response;
      try {
        response = await this.fetch(url, { method: 'GET', headers: { Accept: 'video/mp4' } });
      } catch (cause) {
        lastError = providerError('Replicate video download failed', 'REPLICATE_DOWNLOAD_FAILED', { model: this.model, cause, predictionId });
        if (attempt < this.maxHttpRetries) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw lastError;
      }
      if (!response.ok) {
        lastError = providerError(`Replicate video download failed with HTTP ${response.status}`, 'REPLICATE_DOWNLOAD_FAILED', { model: this.model, predictionId });
        if ((response.status === 429 || response.status >= 500) && attempt < this.maxHttpRetries) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw lastError;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw providerError('Replicate video download returned empty media', 'REPLICATE_DOWNLOAD_EMPTY', { model: this.model, predictionId });
      return bytes;
    }
    throw lastError;
  }

  async finishPrediction({ prediction, headers, input = null, idempotencyKey = null }) {
    const predictionId = prediction.id;
    const startedAt = this.now();
    while (PENDING_STATUSES.has(prediction.status)) {
      const elapsed = this.now() - startedAt;
      if (elapsed >= this.timeoutMs) {
        throw providerError('Replicate prediction polling timed out', 'REPLICATE_TIMEOUT', { model: this.model, predictionId });
      }
      await this.sleep(Math.min(this.pollIntervalMs, this.timeoutMs - elapsed));
      prediction = await this.requestJson(`${this.baseURL}/predictions/${encodeURIComponent(predictionId)}`, {
        method: 'GET',
        headers: { Authorization: headers.Authorization, Accept: 'application/json' },
      }, { retryable: true });
      if (!prediction.id || typeof prediction.status !== 'string') {
        throw providerError('Replicate polling returned a malformed prediction', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model, predictionId });
      }
    }

    if (prediction.status === 'failed') {
      throw providerError(`Replicate prediction failed: ${prediction.error || 'unknown error'}`, 'REPLICATE_PREDICTION_FAILED', { model: this.model, predictionId, cause: prediction.error });
    }
    if (CANCELED_STATUSES.has(prediction.status)) {
      throw providerError(`Replicate prediction ${prediction.status}`, 'REPLICATE_PREDICTION_CANCELED', { model: this.model, predictionId });
    }
    if (prediction.status !== 'succeeded') {
      throw providerError(`Replicate returned unknown prediction status: ${prediction.status}`, 'REPLICATE_MALFORMED_RESPONSE', { model: this.model, predictionId });
    }

    const mediaUrl = outputUrl(prediction);
    if (!mediaUrl) throw providerError('Replicate prediction succeeded without video output', 'REPLICATE_OUTPUT_MISSING', { model: this.model, predictionId });
    const output = await this.downloadVideo(mediaUrl, predictionId);
    return assertProviderResult({
      provider: 'replicate',
      model: this.model,
      capability: 'video-generation',
      output,
      mediaUrl,
      contentType: 'video/mp4',
      requestId: predictionId,
      usage: prediction.metrics || null,
      provenance: {
        provider: 'replicate',
        model: this.model,
        predictionId,
        origin: 'replicate-api',
        ...(input ? { input: safeInputProvenance(input) } : {}),
        outputUrlHash: crypto.createHash('sha256').update(mediaUrl).digest('hex'),
        idempotencyKey: idempotencyKey || null,
      },
    });
  }

  async runPrediction({ input, idempotencyKey, onProviderRequest = null }) {
    if (!this.apiToken) throw providerError('REPLICATE_API_TOKEN is required for video generation', 'REPLICATE_TOKEN_REQUIRED', { model: this.model });
    const [owner, name] = this.model.split('/');
    if (!owner || !name) throw providerError('Replicate model must use owner/name format', 'REPLICATE_MODEL_INVALID', { model: this.model });
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Cancel-After': `${Math.max(5, Math.ceil(this.timeoutMs / 1000))}s`,
    };
    const materialized = await this.materializeInput(input);
    const predictionInput = materialized.input;
    const predictionUrl = `${this.baseURL}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;
    let prediction = await this.requestJson(predictionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: predictionInput }),
    });
    if (!prediction.id || typeof prediction.status !== 'string') {
      throw providerError('Replicate prediction response is missing id or status', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model });
    }
    if (onProviderRequest) await onProviderRequest({ requestId: prediction.id, status: prediction.status, provider: 'replicate', model: this.model });
    return this.finishPrediction({ prediction, headers, input: { ...predictionInput,
      ...(materialized.evidence.length ? { _factoryProviderFiles: materialized.evidence } : {}) }, idempotencyKey });
  }

  async recover({ capability, model, requestId } = {}) {
    if (!this.supports({ capability, model })) {
      throw providerError(`Replicate Wan does not support capability '${capability}'`, 'REPLICATE_CAPABILITY_UNSUPPORTED', { model: model || this.model });
    }
    if (!this.apiToken) throw providerError('REPLICATE_API_TOKEN is required for video recovery', 'REPLICATE_TOKEN_REQUIRED', { model: this.model });
    if (!requestId || typeof requestId !== 'string') throw providerError('Replicate requestId is required for recovery', 'REPLICATE_REQUEST_ID_REQUIRED', { model: this.model });
    const headers = { Authorization: `Bearer ${this.apiToken}`, Accept: 'application/json' };
    const prediction = await this.requestJson(`${this.baseURL}/predictions/${encodeURIComponent(requestId)}`, {
      method: 'GET', headers,
    }, { retryable: true });
    if (!prediction.id || prediction.id !== requestId || typeof prediction.status !== 'string') {
      throw providerError('Replicate recovery returned a malformed prediction', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model, predictionId: requestId });
    }
    return this.finishPrediction({ prediction, headers });
  }

  async generate({ capability, prompt, model, idempotencyKey, ...options } = {}) {
    if (!this.supports({ capability, model })) {
      throw providerError(`Replicate Wan does not support capability '${capability}'`, 'REPLICATE_CAPABILITY_UNSUPPORTED', { model: model || this.model });
    }
    const parsed = parseGenerationPrompt(prompt);
    const canonicalRequest = options.canonicalRequest || null;
    const requirements = parsed.requirements;
    const input = buildWanInput({
      prompt: canonicalRequest?.providerPrompt || options.videoPrompt || parsed.prompt,
      resolution: canonicalRequest?.resolution ?? options.resolution ?? requirements.resolution ?? '720p',
      aspectRatio: canonicalRequest?.aspectRatio ?? options.aspectRatio ?? options.aspect_ratio ?? requirements.aspect_ratio ?? requirements.aspectRatio ?? '9:16',
      numFrames: canonicalRequest?.resolvedSettings?.numFrames ?? options.numFrames ?? options.num_frames ?? requirements.num_frames ?? requirements.numFrames ?? 81,
      framesPerSecond: canonicalRequest?.resolvedSettings?.framesPerSecond ?? options.framesPerSecond ?? options.frames_per_second ?? requirements.frames_per_second ?? requirements.framesPerSecond ?? 16,
      goFast: canonicalRequest?.resolvedSettings?.goFast ?? options.goFast ?? options.go_fast ?? requirements.go_fast ?? requirements.goFast ?? true,
      seed: canonicalRequest?.seed ?? options.seed ?? requirements.seed,
      sampleShift: canonicalRequest?.resolvedSettings?.sampleShift ?? options.sampleShift ?? options.sample_shift ?? requirements.sample_shift ?? 12,
      optimizePrompt: canonicalRequest?.resolvedSettings?.optimizePrompt ?? options.optimizePrompt ?? requirements.optimize_prompt,
      interpolateOutput: canonicalRequest?.resolvedSettings?.interpolateOutput ?? options.interpolateOutput ?? requirements.interpolate_output,
    });

    if (!idempotencyKey) return this.runPrediction({ input, idempotencyKey: null, onProviderRequest: options.onProviderRequest });
    const operationIdentity = JSON.stringify(input);
    if (this.inflight.has(idempotencyKey)) {
      const existing = this.inflight.get(idempotencyKey);
      if (existing.operationIdentity !== operationIdentity) {
        throw providerError('Replicate idempotency key was reused with different input', 'REPLICATE_IDEMPOTENCY_CONFLICT', { model: this.model });
      }
      return existing.promise;
    }
    const operation = this.runPrediction({ input, idempotencyKey, onProviderRequest: options.onProviderRequest });
    this.inflight.set(idempotencyKey, { operationIdentity, promise: operation });
    try {
      return await operation;
    } finally {
      this.inflight.delete(idempotencyKey);
    }
  }
}

module.exports = {
  DEFAULT_MODEL,
  ReplicateWanVideoAdapter,
  buildWanInput,
  outputUrl,
  parseGenerationPrompt,
  safeInputProvenance,
};
