'use strict';

const OpenAI = require('openai');
const { ProviderError } = require('./provider-contract');
const { CAPABILITIES, normalizeCapability } = require('./capability-contract');

const DEFAULT_IMAGE_MODEL = 'flux.2-klein-4b';
const IMAGE_CAPABILITY = CAPABILITIES.IMAGE_GENERATION;

function isPlaceholder(value) {
  return typeof value === 'string' && /^(placeholder:|placeholder\/\/|data:text\/placeholder)/i.test(value.trim());
}

function decodeBase64Image(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.length ? { mimeType: 'image/png', bytes } : null;
  } catch {
    return null;
  }
}

function createNvidiaMediaAdapter({ client, apiKey = process.env.NVIDIA_API_KEY, baseURL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', model = process.env.NVIDIA_IMAGE_MODEL || DEFAULT_IMAGE_MODEL } = {}) {
  const openai = client || new OpenAI({ apiKey, baseURL });

  async function generate({ capability, prompt, model: requestedModel, size, idempotencyKey, metadata = {} } = {}) {
    const canonicalCapability = normalizeCapability(capability || IMAGE_CAPABILITY);
    if (canonicalCapability !== IMAGE_CAPABILITY) {
      throw new ProviderError(`NVIDIA media adapter does not support capability '${canonicalCapability}'`, { provider: 'nvidia', model: requestedModel || model });
    }
    if (!prompt || typeof prompt !== 'string') {
      throw new ProviderError('NVIDIA image generation requires a non-empty prompt', { provider: 'nvidia', model: requestedModel || model });
    }

    const selectedModel = requestedModel || model;
    try {
      const requestOptions = idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined;
      const response = await openai.images.generate({
        model: selectedModel,
        prompt,
        ...(size ? { size } : {}),
      }, requestOptions);

      const item = response?.data?.[0];
      const b64 = item?.b64_json;
      const url = item?.url;
      const decoded = decodeBase64Image(b64);

      if (decoded && decoded.bytes.length > 0) {
        return Object.freeze({
          provider: 'nvidia',
          model: selectedModel,
          capability: IMAGE_CAPABILITY,
          artifact: Object.freeze({
            kind: 'image',
            bytes: decoded.bytes,
            mimeType: decoded.mimeType,
            source: 'provider',
          }),
          requestId: response?.id || null,
          provenance: { provider: 'nvidia', model: selectedModel, capability: IMAGE_CAPABILITY, metadata },
        });
      }

      if (url && !isPlaceholder(url)) {
        return Object.freeze({
          provider: 'nvidia',
          model: selectedModel,
          capability: IMAGE_CAPABILITY,
          artifact: Object.freeze({ kind: 'image', url, source: 'provider' }),
          requestId: response?.id || null,
          provenance: { provider: 'nvidia', model: selectedModel, capability: IMAGE_CAPABILITY, metadata },
        });
      }

      throw new ProviderError('NVIDIA image generation returned no real media artifact', { provider: 'nvidia', model: selectedModel });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('NVIDIA image generation failed', { provider: 'nvidia', model: selectedModel, cause: error });
    }
  }

  return Object.freeze({
    provider: 'nvidia',
    model,
    supports({ capability }) {
      return normalizeCapability(capability || IMAGE_CAPABILITY) === IMAGE_CAPABILITY;
    },
    healthCheck: async () => true,
    generate,
  });
}

module.exports = { createNvidiaMediaAdapter, DEFAULT_IMAGE_MODEL, IMAGE_CAPABILITY };
