'use strict';

const { ProviderAdapter, buildStageInstructions } = require('./v2.4-provider-adapter');

function createOpenAIProvider({ client, model = process.env.CONTENT_BRAIN_MODEL || 'gpt-5.6-luna' }) {
  if (!client || !client.responses || typeof client.responses.create !== 'function') {
    throw new TypeError('client.responses.create must be available');
  }

  return new ProviderAdapter({
    generate: async ({ stage, inputs }) => {
      const response = await client.responses.create({
        model,
        input: [
          {
            role: 'system',
            content: buildStageInstructions(stage)
          },
          {
            role: 'user',
            content: JSON.stringify({ stage, inputs })
          }
        ]
      });
      if (!response || typeof response.output_text !== 'string' || !response.output_text.trim()) {
        throw new Error(`OpenAI provider returned empty output for ${stage}`);
      }
      return { model, stage, text: response.output_text };
    }
  });
}

module.exports = { createOpenAIProvider };
