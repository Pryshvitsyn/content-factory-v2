'use strict';

const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_MODEL = 'wan-video/wan-2.2-t2v-fast';
const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';
const PENDING_STATUSES = new Set(['queued', 'starting', 'processing']);
const CANCELED_STATUSES = new Set(['canceled', 'aborted']);

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

  async runPrediction({ input, idempotencyKey }) {
    if (!this.apiToken) throw providerError('REPLICATE_API_TOKEN is required for video generation', 'REPLICATE_TOKEN_REQUIRED', { model: this.model });
    const [owner, name] = this.model.split('/');
    if (!owner || !name) throw providerError('Replicate model must use owner/name format', 'REPLICATE_MODEL_INVALID', { model: this.model });
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Cancel-After': `${Math.max(5, Math.ceil(this.timeoutMs / 1000))}s`,
    };
    const predictionUrl = `${this.baseURL}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;
    let prediction = await this.requestJson(predictionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    });
    if (!prediction.id || typeof prediction.status !== 'string') {
      throw providerError('Replicate prediction response is missing id or status', 'REPLICATE_MALFORMED_RESPONSE', { model: this.model });
    }

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
        input,
        outputUrl: mediaUrl,
        idempotencyKey: idempotencyKey || null,
      },
    });
  }

  async generate({ capability, prompt, model, idempotencyKey, ...options } = {}) {
    if (!this.supports({ capability, model })) {
      throw providerError(`Replicate Wan does not support capability '${capability}'`, 'REPLICATE_CAPABILITY_UNSUPPORTED', { model: model || this.model });
    }
    const parsed = parseGenerationPrompt(prompt);
    const requirements = parsed.requirements;
    const input = buildWanInput({
      prompt: options.videoPrompt || parsed.prompt,
      resolution: options.resolution ?? requirements.resolution ?? '720p',
      aspectRatio: options.aspectRatio ?? options.aspect_ratio ?? requirements.aspect_ratio ?? requirements.aspectRatio ?? '9:16',
      numFrames: options.numFrames ?? options.num_frames ?? requirements.num_frames ?? requirements.numFrames ?? 81,
      framesPerSecond: options.framesPerSecond ?? options.frames_per_second ?? requirements.frames_per_second ?? requirements.framesPerSecond ?? 16,
      goFast: options.goFast ?? options.go_fast ?? requirements.go_fast ?? requirements.goFast ?? true,
      seed: options.seed ?? requirements.seed,
      sampleShift: options.sampleShift ?? options.sample_shift ?? requirements.sample_shift ?? 12,
      optimizePrompt: options.optimizePrompt ?? requirements.optimize_prompt,
      interpolateOutput: options.interpolateOutput ?? requirements.interpolate_output,
    });

    if (!idempotencyKey) return this.runPrediction({ input, idempotencyKey: null });
    const operationIdentity = JSON.stringify(input);
    if (this.inflight.has(idempotencyKey)) {
      const existing = this.inflight.get(idempotencyKey);
      if (existing.operationIdentity !== operationIdentity) {
        throw providerError('Replicate idempotency key was reused with different input', 'REPLICATE_IDEMPOTENCY_CONFLICT', { model: this.model });
      }
      return existing.promise;
    }
    const operation = this.runPrediction({ input, idempotencyKey });
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
};
