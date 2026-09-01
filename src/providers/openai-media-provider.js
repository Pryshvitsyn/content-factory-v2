'use strict';

const OpenAI = require('openai');
const { toFile } = require('openai');
const { ProviderError, assertProviderResult } = require('./provider-contract');

const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
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
  const openai = client || new OpenAI({ apiKey });

  return Object.freeze({
    provider: 'openai-media',

    modelFor({ capability } = {}) {
      if (capability === 'image-generation' || capability === 'multi-view-identity-reference') return imageModel;
      if (capability === 'speech-generation') return speechModel;
      return null;
    },

    supports({ capability, model } = {}) {
      if (capability === 'image-generation' || capability === 'multi-view-identity-reference') return !model || model === imageModel;
      if (capability === 'speech-generation') return !model || model === speechModel;
      return false;
    },

    async generate({ capability, prompt, model, idempotencyKey, referenceImages = [], onProviderRequest = null } = {}) {
      const asset = parseAssetPrompt(prompt);
      const requirements = asset.generation_requirements || {};
      try {
        if (capability === 'image-generation') {
          const selectedModel = model || imageModel;
          const response = await openai.images.generate({
            model: selectedModel,
            prompt: [asset.description, requirements.prompt, requirements.visual_style, requirements.negative_prompt && `Avoid: ${requirements.negative_prompt}`]
              .filter(Boolean).join('\n'),
            size: requirements.size || '1024x1536',
            quality: requirements.quality || 'high',
            n: 1,
          }, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined);
          const item = response?.data?.[0] || {};
          if (onProviderRequest && response.id) await onProviderRequest({ requestId: response.id, status: 'succeeded', provider: 'openai-media', model: selectedModel });
          const output = item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
          return assertProviderResult({
            provider: 'openai-media', model: selectedModel, capability,
            output, mediaUrl: item.url || null, contentType: 'image/png',
            requestId: response.id || null, usage: response.usage || null,
            provenance: { provider: 'openai-media', model: selectedModel },
          });
        }

        if (capability === 'multi-view-identity-reference') {
          if (!Array.isArray(referenceImages) || !referenceImages.length) {
            throw new Error('Multi-view identity generation requires at least one approved reference image');
          }
          const selectedModel = model || imageModel;
          const images = await Promise.all(referenceImages.map((reference, index) => toFile(
            reference.bytes,
            reference.filename || `identity-reference-${index + 1}.png`,
            { type: reference.contentType || 'image/png' },
          )));
          const response = await openai.images.edit({
            model: selectedModel,
            image: images,
            prompt: [asset.description, requirements.prompt, requirements.visual_style,
              requirements.negative_prompt && `Avoid: ${requirements.negative_prompt}`].filter(Boolean).join('\n'),
            size: requirements.size || '1536x1024',
            quality: requirements.quality || 'high',
            n: 1,
          }, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined);
          const item = response?.data?.[0] || {};
          if (onProviderRequest && response.id) await onProviderRequest({ requestId: response.id, status: 'succeeded',
            provider: 'openai-media', model: selectedModel });
          const output = item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
          return assertProviderResult({
            provider: 'openai-media', model: selectedModel, capability, output, mediaUrl: item.url || null,
            contentType: 'image/png', requestId: response.id || null, usage: response.usage || null,
            provenance: { provider: 'openai-media', model: selectedModel, strategy: 'ONE_EDIT_CALL_PER_THREE_VIEW_COMPOSITE',
              referenceImageCount: referenceImages.length },
          });
        }

        if (capability === 'speech-generation') {
          const selectedModel = model || speechModel;
          const input = String(requirements.text || requirements.script || asset.description || '').trim();
          if (!input) throw new Error('Speech asset requires generation_requirements.text');
          const response = await openai.audio.speech.create({
            model: selectedModel,
            voice: requirements.voice || defaultVoice,
            input,
            response_format: 'mp3',
            ...(requirements.instructions ? { instructions: requirements.instructions } : {}),
          }, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined);
          const requestId = response.headers?.get?.('x-request-id') || null;
          if (onProviderRequest && requestId) await onProviderRequest({ requestId, status: 'succeeded', provider: 'openai-media', model: selectedModel });
          const output = Buffer.from(await response.arrayBuffer());
          return assertProviderResult({
            provider: 'openai-media', model: selectedModel, capability,
            output, contentType: 'audio/mpeg',
            requestId,
            provenance: { provider: 'openai-media', model: selectedModel, voice: requirements.voice || defaultVoice },
          });
        }

        throw new Error(`OpenAI media provider does not support capability '${capability}'`);
      } catch (cause) {
        if (cause instanceof ProviderError) throw cause;
        throw new ProviderError(`OpenAI ${capability} request failed`, {
          provider: 'openai-media', model: model || this.modelFor({ capability }), cause,
        });
      }
    },
  });
}

module.exports = { createOpenAIMediaProvider, DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL, parseAssetPrompt };
