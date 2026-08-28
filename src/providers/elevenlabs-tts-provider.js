'use strict';

const { ProviderError, assertProviderResult } = require('./provider-contract');
const { parseAssetPrompt } = require('./openai-media-provider');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createElevenLabsTtsProvider({ apiKey = process.env.ELEVENLABS_API_KEY, model = 'eleven_v3',
  fetchImpl = global.fetch, timeoutMs = 60_000, maxHttpRetries = 2, sleep = wait } = {}) {
  if (!fetchImpl) throw new Error('ElevenLabs TTS provider requires fetch');
  return Object.freeze({
    provider: 'elevenlabs', modelFor: ({ capability } = {}) => capability === 'speech-generation' ? model : null,
    supports: ({ capability, model: selected } = {}) => capability === 'speech-generation' && (!selected || selected === model),
    healthCheck: async () => Boolean(apiKey),
    async generate({ capability, prompt, model: selectedModel, onProviderRequest = null } = {}) {
      if (capability !== 'speech-generation' || (selectedModel && selectedModel !== model)) throw new ProviderError('ElevenLabs speech capability/model unsupported', { provider: 'elevenlabs', model: selectedModel });
      if (!apiKey) throw new ProviderError('ELEVENLABS_API_KEY is required', { provider: 'elevenlabs', model });
      const asset = parseAssetPrompt(prompt); const requirements = asset.generation_requirements || {};
      const input = String(requirements.text || requirements.script || asset.description || '').trim();
      const voiceId = String(requirements.voice_id || requirements.voiceId || requirements.voice || '').trim();
      if (!input) throw new ProviderError('ElevenLabs speech text is required', { provider: 'elevenlabs', model });
      if (!voiceId) throw new ProviderError('ElevenLabs voiceId is required', { provider: 'elevenlabs', model });
      let response; let lastCause;
      for (let attempt = 0; attempt <= maxHttpRetries; attempt += 1) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
            method: 'POST', signal: controller.signal, headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text: input, model_id: model, ...(requirements.language ? { language_code: requirements.language } : {}),
              ...(requirements.voice_settings ? { voice_settings: requirements.voice_settings } : {}) }),
          });
        } catch (cause) { lastCause = cause; response = null; } finally { clearTimeout(timer); }
        if (response?.ok) break;
        if (response && response.status !== 429 && response.status < 500) throw new ProviderError(`ElevenLabs returned HTTP ${response.status}`, { provider: 'elevenlabs', model });
        if (attempt < maxHttpRetries) await sleep(Math.min(1000 * (2 ** attempt), 4000));
      }
      if (!response?.ok) throw new ProviderError('ElevenLabs request failed after bounded retries', { provider: 'elevenlabs', model, cause: lastCause });
      const output = Buffer.from(await response.arrayBuffer());
      if (!output.length) throw new ProviderError('ElevenLabs returned empty audio', { provider: 'elevenlabs', model });
      const requestId = response.headers?.get?.('request-id') || response.headers?.get?.('x-request-id') || null;
      if (onProviderRequest && requestId) await onProviderRequest({ requestId, status: 'succeeded', provider: 'elevenlabs', model });
      return assertProviderResult({ provider: 'elevenlabs', model, capability, output, contentType: 'audio/mpeg', requestId,
        usage: { characters: input.length, characterCost: response.headers?.get?.('character-cost') || null },
        provenance: { provider: 'elevenlabs', model, voiceId, language: requirements.language || null } });
    },
  });
}

module.exports = { createElevenLabsTtsProvider };
