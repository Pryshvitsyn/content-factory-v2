'use strict';

const assert = require('node:assert/strict');
const { providerGateway } = require('../src/v2.7/production-runtime');

function adapter(provider, capability, model, calls) {
  return Object.freeze({ provider, supports: ({ capability: requested, model: selected }) => requested === capability
    && (!selected || selected === model), modelFor: () => model, async generate(request) {
    calls.push({ provider, capability: request.capability, model: request.model });
    return { provider, model, output: Buffer.from('mock-media'), contentType: 'audio/mpeg' };
  } });
}

async function main() {
  const config = { provider: 'replicate', model: 'wan-test', adapterFamily: 'replicate-wan',
    audioProvider: 'openai-media', audioModel: 'gpt-4o-mini-tts' };
  const http = { video: 0, speech: [] };
  const gateway = providerGateway({ config, live: true,
    executionPolicy: { video: 'FORBIDDEN', speech: 'LIVE' }, env: { OPENAI_API_KEY: 'synthetic-test-key' },
    videoAdapterFactory() { http.video += 1; throw new Error('video adapter must not be instantiated'); },
    openAIMediaProviderFactory() { return adapter('openai-media', 'speech-generation',
      'gpt-4o-mini-tts', http.speech); } });
  await assert.rejects(() => gateway.generate({ capability: 'video-generation', provider: 'replicate',
    model: 'wan-test', prompt: '{}' }), (error) => error.code === 'SEMANTIC_RECOVERY_VIDEO_GENERATION_FORBIDDEN');
  assert.equal(http.video, 0, 'forbidden recovery video must not instantiate or call Replicate');
  const speech = await gateway.generate({ capability: 'speech-generation', provider: 'openai-media',
    model: 'gpt-4o-mini-tts', prompt: JSON.stringify({ generation_requirements: { text: 'Approved copy.', voice: 'alloy' } }) });
  assert.equal(speech.provenance.provider, 'openai-media');
  assert.deepEqual(http.speech, [{ provider: 'openai-media', capability: 'speech-generation', model: 'gpt-4o-mini-tts' }]);

  const elevenCalls = [];
  const eleven = providerGateway({ config: { ...config, audioProvider: 'elevenlabs', audioModel: 'eleven_v3' },
    live: true, executionPolicy: { video: 'FORBIDDEN', speech: 'LIVE' }, env: { ELEVENLABS_API_KEY: 'synthetic' },
    videoAdapterFactory() { throw new Error('video adapter must not be instantiated'); },
    elevenLabsTtsProviderFactory() { return adapter('elevenlabs', 'speech-generation', 'eleven_v3', elevenCalls); } });
  await eleven.generate({ capability: 'speech-generation', provider: 'elevenlabs', model: 'eleven_v3', prompt: '{}' });
  assert.equal(elevenCalls.length, 1, 'selected ElevenLabs speech must remain live without fallback');
  assert.throws(() => providerGateway({ config: { ...config, audioProvider: 'unknown-speech' }, live: true,
    executionPolicy: { video: 'FORBIDDEN', speech: 'LIVE' } }), /Unsupported live speech provider/,
  'semantic recovery must never silently fall back to a different speech provider');
  console.log('V2.9.2.2 capability-scoped provider gateway passed (video forbidden, selected speech live).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
