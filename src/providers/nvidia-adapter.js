'use strict';

const OpenAI = require('openai');
const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

function createNvidiaAdapter({ client, apiKey = process.env.NVIDIA_API_KEY, model = process.env.NVIDIA_MODEL || DEFAULT_MODEL } = {}) {
  const openai = client || new OpenAI({
    apiKey,
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  });

  return Object.freeze({
    provider: 'nvidia',
    model,

    async generate({ system, prompt, temperature = 0.2, maxTokens = 1024, metadata = {}, idempotencyKey }) {
      if (!prompt || typeof prompt !== 'string') {
        throw new ProviderError('NVIDIA request requires a non-empty prompt', { provider: 'nvidia', model });
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

module.exports = { createNvidiaAdapter, DEFAULT_MODEL };
