'use strict';

const { ProviderAdapter, buildStageInstructions } = require('./v2.4-provider-adapter');

class NvidiaProvider extends ProviderAdapter {
  constructor({ apiKey, model = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b', baseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1' } = {}) {
    if (!apiKey) throw new Error('NVIDIA_API_KEY is required');
    super({
      generate: async ({ stage, inputs, instructions }) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: instructions || buildStageInstructions(stage) },
              { role: 'user', content: JSON.stringify({ stage, inputs }) }
            ]
          })
        });
        if (!response.ok) throw new Error(`NVIDIA provider HTTP ${response.status}`);
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('NVIDIA provider returned empty content');
        return { stage, model, content: text };
      }
    });
  }
}

module.exports = { NvidiaProvider };
