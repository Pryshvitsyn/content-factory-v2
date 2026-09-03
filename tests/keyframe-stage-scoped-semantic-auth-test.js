'use strict';

const assert = require('node:assert/strict');
const { lockedKeyframeSemanticEnvironment } = require('../apps/dashboard/server');

function main() {
  const noKey = { LIVE_PAID_VISUAL_EVALUATION: 'false' };
  assert.equal(lockedKeyframeSemanticEnvironment(noKey), noKey,
    'without an OpenAI key, locked keyframe semantic runtime must remain unconfigured');

  const env = lockedKeyframeSemanticEnvironment({
    OPENAI_API_KEY: 'synthetic-never-log',
    SEMANTIC_VISUAL_ENABLED: 'false',
    SEMANTIC_VISUAL_PROVIDER: 'openai',
    SEMANTIC_VISUAL_MODEL: 'your_explicit_vision_capable_model',
    LIVE_PAID_VISUAL_EVALUATION: 'false',
  });
  assert.equal(env.SEMANTIC_VISUAL_ENABLED, 'true',
    'confirmed locked-keyframe runtime must override the broad disabled flag only inside this stage');
  assert.equal(env.SEMANTIC_VISUAL_PROVIDER, 'openai');
  assert.equal(env.SEMANTIC_VISUAL_MODEL, 'gpt-5.6-luna',
    'placeholder semantic model values must resolve to the safe locked-keyframe default');
  assert.equal(env.LIVE_PAID_VISUAL_EVALUATION, 'true',
    'authorization is scoped to the keyframe service, whose execute endpoint requires explicit confirmation');

  const explicit = lockedKeyframeSemanticEnvironment({
    OPENAI_API_KEY: 'synthetic-never-log',
    SEMANTIC_VISUAL_ENABLED: 'false',
    SEMANTIC_VISUAL_PROVIDER: 'other-provider',
    SEMANTIC_VISUAL_MODEL: 'explicit-vision-model',
    LIVE_PAID_VISUAL_EVALUATION: 'false',
  });
  assert.equal(explicit.SEMANTIC_VISUAL_ENABLED, 'true');
  assert.equal(explicit.SEMANTIC_VISUAL_PROVIDER, 'openai',
    'locked-keyframe semantic evaluator currently uses the supported OpenAI adapter');
  assert.equal(explicit.SEMANTIC_VISUAL_MODEL, 'explicit-vision-model');
  assert.equal(explicit.LIVE_PAID_VISUAL_EVALUATION, 'true');

  console.log('Locked-keyframe stage-scoped semantic authorization defaults passed.');
}

main();
