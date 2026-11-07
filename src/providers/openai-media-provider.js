'use strict';

const OpenAI = require('openai');
const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5';
const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts';

function parseAssetPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') throw new Error('Media prompt must be a non-empty string');
  try { return JSON.parse(prompt); } catch { return { description: prompt, generation_requirements: {} }; }
}

function createOpenAIMediaProvider({
  client,
  apiKey = process.env.OPENAI_API_KEY,
  imageModel = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  speechModel = process.env.OPENAI_SPEECH_MODEL || DEFAULT_SPEECH_MODEL,
  defaultVoice = process.env.OPENAI_SPEECH_VOICE || 'alloy',
} = {}) {
  const openai = client || new OpenAI({ apiKey, maxRetries: 0 });

  return Object.freeze({
    provider: 'openai-media',

    modelFor({ capability } = {}) {
      if (capability === 'image-generation') return imageModel;
      if (capability === 'speech-generation') return speechModel;
      return null;
    },

    supports({ capability, model } = {}) {
      if (capability === 'image-generation') return !model || model === imageModel;
      if (capability === 'speech-generation') return !model || model === speechModel;
      return false;
    },

    async generate({ capability, prompt, model, idempotencyKey, onProviderRequest = null } = {}) {
      const asset = parseAssetPrompt(prompt);
      const requirements = asset.generation_requirements || {};
      const selectedModel = model || this.modelFor({ capability });
      const compiled = require('../v2.8/provider-request-compiler').compileAuxiliaryRequest({ asset, capability,
        provider: 'openai', model: selectedModel, defaultVoice });
      let acceptedId = null;
      const requestOptions = { maxRetries: 0, ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) };
      try {
        if (capability === 'image-generation') {
          const selectedModel = model || imageModel;
          const response = await openai.images.generate(compiled.payload, requestOptions);
          acceptedId = response.id || response._request_id || null;
          const item = response?.data?.[0] || {};
          if (onProviderRequest && acceptedId) await onProviderRequest({ requestId: acceptedId, status: 'succeeded', provider: 'openai-media', model: selectedModel });
          const output = item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
          return assertProviderResult({
            provider: 'openai-media', model: selectedModel, capability,
            output, mediaUrl: item.url || null, contentType: 'image/png',
            requestId: acceptedId, usage: response.usage || null,
            provenance: { provider: 'openai-media', providerRequest: compiled.summary, model: selectedModel },
          });
        }

        if (capability === 'speech-generation') {
          const selectedModel = model || speechModel;
          const input = String(requirements.text || requirements.script || asset.description || '').trim();
          if (!input) throw new Error('Speech asset requires generation_requirements.text');
          const response = await openai.audio.speech.create(compiled.payload, requestOptions);
          const requestId = response.headers?.get?.('x-request-id') || null;
          acceptedId = requestId;
          if (onProviderRequest && requestId) await onProviderRequest({ requestId, status: 'succeeded', provider: 'openai-media', model: selectedModel });
          const output = Buffer.from(await response.arrayBuffer());
          return assertProviderResult({
            provider: 'openai-media', model: selectedModel, capability,
            output, contentType: 'audio/mpeg',
            requestId,
            provenance: { provider: 'openai-media', providerRequest: compiled.summary, model: selectedModel, voice: requirements.voice || defaultVoice },
          });
        }

        throw new Error(`OpenAI media provider does not support capability '${capability}'`);
      } catch (cause) {
        if (cause instanceof ProviderError) { cause.predictionId ||= acceptedId; throw cause; }
        const error = new ProviderError(`OpenAI ${capability} request failed`, {
          provider: 'openai-media', model: model || this.modelFor({ capability }), cause,
        });
        error.predictionId = acceptedId;
        throw error;
      }
    },
  });
}

module.exports = { createOpenAIMediaProvider, DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL, parseAssetPrompt };
