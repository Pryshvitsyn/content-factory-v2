'use strict';

const assert = require('node:assert/strict');
const { createOpenAIProvider } = require('../worker/v2.4-openai-provider');

(async () => {
  let request;
  const client = {
    responses: {
      create: async (value) => {
        request = value;
        return { output_text: '{"ok":true}' };
      }
    }
  };

  const provider = createOpenAIProvider({ client, model: 'test-model' });
  const result = await provider.generateStage({
    stage: 'INTENT',
    inputs: { IDEA: { text: 'test idea' } }
  });

  assert.equal(result.model, 'test-model');
  assert.equal(result.stage, 'INTENT');
  assert.equal(result.text, '{"ok":true}');
  assert.equal(request.model, 'test-model');
  assert.equal(request.input[0].role, 'system');
  assert.equal(request.input[1].role, 'user');

  await assert.rejects(
    () => createOpenAIProvider({ client: {} }),
    /client\.responses\.create must be available/
  );

  console.log('V2.4 OpenAI provider certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
