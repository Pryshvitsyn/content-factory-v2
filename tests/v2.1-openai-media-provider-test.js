'use strict';

const assert = require('node:assert/strict');
const { createOpenAIMediaProvider } = require('../src/providers/openai-media-provider');
const { ProviderGateway } = require('../src/providers/provider-gateway');

async function main() {
  const calls = [];
  const client = {
    images: {
      async generate(request, options) {
        calls.push({ type: 'image', request, options });
        return { id: 'image-request', data: [{ b64_json: Buffer.from('png').toString('base64') }] };
      },
    },
    audio: {
      speech: {
        async create(request, options) {
          calls.push({ type: 'speech', request, options });
          return { arrayBuffer: async () => Uint8Array.from(Buffer.from('mp3')).buffer, headers: { get: () => 'speech-request' } };
        },
      },
    },
  };
  const provider = createOpenAIMediaProvider({ client, imageModel: 'image-test', speechModel: 'speech-test' });
  const gateway = new ProviderGateway({ providers: { media: provider } });

  const image = await gateway.generate({
    capability: 'image-generation',
    idempotencyKey: 'image-idempotency',
    prompt: JSON.stringify({ description: 'premium product shot', generation_requirements: { visual_style: 'cinematic', size: '1024x1536' } }),
  });
  assert.equal(image.contentType, 'image/png');
  assert.equal(image.output.toString(), 'png');
  assert.equal(calls[0].request.model, 'image-test');
  assert.match(calls[0].request.prompt, /cinematic/);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'image-idempotency');

  const speech = await gateway.generate({
    capability: 'speech-generation',
    idempotencyKey: 'speech-idempotency',
    prompt: JSON.stringify({ description: 'narration', generation_requirements: { text: 'Try it today.', voice: 'nova' } }),
  });
  assert.equal(speech.contentType, 'audio/mpeg');
  assert.equal(speech.output.toString(), 'mp3');
  assert.equal(calls[1].request.model, 'speech-test');
  assert.equal(calls[1].request.input, 'Try it today.');
  assert.equal(calls[1].request.voice, 'nova');

  await assert.rejects(
    () => gateway.generate({ capability: 'speech-generation', prompt: JSON.stringify({ description: '' }) }),
    (error) => /Speech asset requires/.test(error.cause?.message || ''),
  );
  console.log('v2.1 OpenAI image and speech provider certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
