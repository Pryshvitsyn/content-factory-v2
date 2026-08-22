'use strict';

const OpenAI = require('openai');
const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';
const DEFAULT_IMAGE_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b';

function decodeImageArtifact(artifact) {
  const encoded = artifact?.base64 || artifact?.b64_json || null;
  if (!encoded || typeof encoded !== 'string') return null;
  const prefixMatch = encoded.match(/^data:([^;]+);base64,(.+)$/);
  return {
    contentType: artifact.mime_type || artifact.content_type || (prefixMatch ? prefixMatch[1] : 'image/png'),
    output: Buffer.from(prefixMatch ? prefixMatch[2] : encoded, 'base64'),
  };
}

function createNvidiaAdapter({
  client,
  apiKey = process.env.NVIDIA_API_KEY,
  model = process.env.NVIDIA_MODEL || DEFAULT_MODEL,
  imageModel = process.env.NVIDIA_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  imageUrl = process.env.NVIDIA_IMAGE_URL || DEFAULT_IMAGE_URL,
  imageFetch = globalThis.fetch,
  healthFetch = globalThis.fetch,
} = {}) {
  const openai = client || new OpenAI({
    apiKey,
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  });

  if (typeof imageFetch !== 'function') throw new Error('NVIDIA image adapter requires fetch');

  return Object.freeze({
    provider: 'nvidia',
    model,

    supports({ capability } = {}) {
      return capability === 'text-generation' || capability === 'image-generation';
    },

    async healthCheck() {
      if (!apiKey || typeof healthFetch !== 'function') return true;
      try {
        const response = await healthFetch('https://ai.api.nvidia.com/v1/health/ready', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return Boolean(response?.ok);
      } catch {
        return false;
      }
    },

    async generate({ capability = 'text-generation', system, prompt, temperature = 0.2, maxTokens = 1024, metadata = {}, idempotencyKey, seed = 0 } = {}) {
      if (!prompt || typeof prompt !== 'string') {
        throw new ProviderError('NVIDIA request requires a non-empty prompt', { provider: 'nvidia', model });
      }

      if (capability === 'image-generation') {
        if (!apiKey) throw new ProviderError('NVIDIA image generation requires NVIDIA_API_KEY', { provider: 'nvidia', model: imageModel });
        try {
          const response = await imageFetch(imageUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: JSON.stringify({
              mode: 'Image Generation',
              prompt,
              samples: 1,
              seed: Number.isInteger(seed) && seed >= 0 ? seed : 0,
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new ProviderError(`NVIDIA image generation failed with HTTP ${response.status}`, {
              provider: 'nvidia', model: imageModel, cause: payload,
            });
          }

          const decoded = decodeImageArtifact(payload?.artifacts?.[0] || payload?.data?.[0]);
          if (!decoded || !decoded.output.length) {
            throw new ProviderError('NVIDIA image generation returned no image artifact', { provider: 'nvidia', model: imageModel });
          }

          return Object.freeze({
            provider: 'nvidia',
            model: payload.model || imageModel,
            output: decoded.output,
            contentType: decoded.contentType,
            requestId: payload.id || payload.request_id || null,
            usage: payload.usage || null,
            raw: { metadata },
          });
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError('NVIDIA image request failed', { provider: 'nvidia', model: imageModel, cause: error });
        }
      }

      if (capability !== 'text-generation') {
        throw new ProviderError(`NVIDIA does not support capability '${capability}'`, { provider: 'nvidia', model });
      }

      try {
        const request = {
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
        };
        const requestOptions = idempotencyKey
          ? { headers: { 'Idempotency-Key': idempotencyKey } }
          : undefined;
        const response = await openai.chat.completions.create(request, requestOptions);

        const output = response?.choices?.[0]?.message?.content;
        if (typeof output !== 'string' || output.length === 0) {
          throw new ProviderError('NVIDIA returned an empty output', { provider: 'nvidia', model });
        }

        return assertProviderResult({
          provider: 'nvidia',
          model,
          output,
          requestId: response.id || null,
          usage: response.usage || null,
          raw: { metadata },
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('NVIDIA request failed', { provider: 'nvidia', model, cause: error });
      }
    },
  });
}

module.exports = { createNvidiaAdapter, DEFAULT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_URL, decodeImageArtifact };
