'use strict';

const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_MODEL = 'wan-ai/wan2.2';
const DEFAULT_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

function isMp4(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
}

function decodeVideo(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const bytes = Buffer.from(value, 'base64');
  return isMp4(bytes) ? bytes : null;
}

function createNvidiaVideoAdapter({
  apiKey = process.env.NVIDIA_API_KEY,
  baseURL = DEFAULT_BASE_URL,
  model = process.env.NVIDIA_VIDEO_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('NVIDIA video adapter requires fetch');

  return Object.freeze({
    provider: 'nvidia',
    model,

    supports({ capability, model: requestedModel } = {}) {
      return capability === 'video-generation' && (!requestedModel || requestedModel === model);
    },

    async generate({
      prompt,
      inputReference,
      size = '832x480',
      seconds = 4,
      metadata = {},
      idempotencyKey,
    } = {}) {
      if (!prompt || typeof prompt !== 'string') {
        throw new ProviderError('NVIDIA video request requires a non-empty prompt', { provider: 'nvidia', model });
      }
      if (!apiKey) {
        throw new ProviderError('NVIDIA video request requires NVIDIA_API_KEY', { provider: 'nvidia', model });
      }
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new ProviderError('NVIDIA video request requires positive seconds', { provider: 'nvidia', model });
      }

      const payload = { model, prompt, size, seconds };
      if (inputReference) payload.input_reference = inputReference;

      try {
        const response = await fetchImpl(`${baseURL.replace(/\/$/, '')}/videos/generations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new ProviderError(`NVIDIA video request failed with HTTP ${response.status}`, {
            provider: 'nvidia',
            model,
            cause: body,
          });
        }

        const item = body?.data?.[0];
        const videoBytes = decodeVideo(item?.b64_json);
        if (!videoBytes) {
          throw new ProviderError('NVIDIA returned no real MP4 video artifact', {
            provider: 'nvidia',
            model,
            cause: body,
          });
        }

        return assertProviderResult({
          provider: 'nvidia',
          model,
          output: videoBytes.toString('base64'),
          requestId: body?.id || body?.request_id || null,
          raw: {
            mediaType: 'video/mp4',
            sizeBytes: videoBytes.length,
            seconds,
            request: payload,
            metadata,
          },
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('NVIDIA video request failed', { provider: 'nvidia', model, cause: error });
      }
    },
  });
}

module.exports = { createNvidiaVideoAdapter, DEFAULT_MODEL };
