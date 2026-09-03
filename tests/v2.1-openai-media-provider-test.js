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
      async edit(request, options) {
        calls.push({ type: 'identity-reference', request, options });
        return { id: 'passport-request', data: [{ b64_json: Buffer.from('passport-png').toString('base64') }] };
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

  const passport = await gateway.generate({
    capability: 'multi-view-identity-reference', provider: 'media', model: 'image-test',
    idempotencyKey: 'passport-idempotency', prompt: JSON.stringify({ description: 'three-panel passport',
      generation_requirements: { prompt: 'frontal, 45 degree, profile', size: '1536x1024' } }),
    referenceImages: [{ bytes: Buffer.from('reference'), filename: 'reference.png', contentType: 'image/png' }],
  });
  assert.equal(passport.output.toString(),'passport-png');
  assert.equal(passport.requestId,'passport-request');
  assert.equal(calls[1].type,'identity-reference');
  assert.equal(calls[1].request.model,'image-test');
  assert.equal(calls[1].request.image.length,1);
  assert.equal(calls[1].options.headers['Idempotency-Key'],'passport-idempotency');

  const speech = await gateway.generate({
    capability: 'speech-generation',
    idempotencyKey: 'speech-idempotency',
    prompt: JSON.stringify({ description: 'narration', generation_requirements: { text: 'Try it today.', voice: 'nova' } }),
  });
  assert.equal(speech.contentType, 'audio/mpeg');
  assert.equal(speech.output.toString(), 'mp3');
  assert.equal(calls[2].request.model, 'speech-test');
  assert.equal(calls[2].request.input, 'Try it today.');
  assert.equal(calls[2].request.voice, 'nova');

  await assert.rejects(
    () => gateway.generate({ capability: 'speech-generation', prompt: JSON.stringify({ description: '' }) }),
    (error) => /Speech asset requires/.test(error.cause?.message || ''),
  );
  console.log('v2.1 OpenAI image and speech provider certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
