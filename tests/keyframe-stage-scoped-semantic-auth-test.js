'use strict';

const assert = require('node:assert/strict');
const { lockedKeyframeSemanticEnvironment } = require('../apps/dashboard/server');

function main() {
  const noKey = { LIVE_PAID_VISUAL_EVALUATION: 'false' };
  assert.equal(lockedKeyframeSemanticEnvironment(noKey), noKey,
    'without an OpenAI key, locked keyframe semantic runtime must remain unconfigured');

  const env = lockedKeyframeSemanticEnvironment({
    OPENAI_API_KEY: 'synthetic-never-log',
    LIVE_PAID_VISUAL_EVALUATION: 'false',
  });
  assert.equal(env.SEMANTIC_VISUAL_ENABLED, 'true');
  assert.equal(env.SEMANTIC_VISUAL_PROVIDER, 'openai');
  assert.equal(env.SEMANTIC_VISUAL_MODEL, 'gpt-5.6-luna');
  assert.equal(env.LIVE_PAID_VISUAL_EVALUATION, 'true',
    'authorization is scoped to the keyframe service, whose execute endpoint requires explicit confirmation');

  const explicit = lockedKeyframeSemanticEnvironment({
    OPENAI_API_KEY: 'synthetic-never-log',
    SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai',
    SEMANTIC_VISUAL_MODEL: 'explicit-vision-model',
    LIVE_PAID_VISUAL_EVALUATION: 'false',
  });
  assert.equal(explicit.SEMANTIC_VISUAL_MODEL, 'explicit-vision-model');
  assert.equal(explicit.LIVE_PAID_VISUAL_EVALUATION, 'true');

  console.log('Locked-keyframe stage-scoped semantic authorization defaults passed.');
}

main();
