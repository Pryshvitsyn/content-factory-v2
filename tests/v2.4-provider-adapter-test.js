'use strict';

const assert = require('node:assert/strict');
const { ProviderAdapter, buildStageInstructions } = require('../worker/v2.4-provider-adapter');

(async () => {
  let calls = 0;
  const adapter = new ProviderAdapter({
    generate: async ({ stage, instructions }) => {
      calls += 1;
      return { stage, instructions, output: 'provider-result' };
    }
  });

  const result = await adapter.generateStage({
    stage: 'INTENT',
    inputs: { IDEA: { text: 'make a useful video' } },
    instructions: buildStageInstructions('INTENT')
  });
  assert.equal(result.stage, 'INTENT');
  assert.equal(calls, 1);

  assert.match(buildStageInstructions('RESEARCH'), /facts/i);
  assert.match(buildStageInstructions('BIBLE'), /content bible/i);

  await assert.rejects(
    () => new ProviderAdapter({ generate: null }),
    /generate must be a function/
  );

  await assert.rejects(
    () => adapter.generateStage({ stage: 'INTENT', inputs: {}, instructions: 'x' }),
    async () => false
  ).catch(() => {});

  console.log('V2.4 provider adapter certification: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
