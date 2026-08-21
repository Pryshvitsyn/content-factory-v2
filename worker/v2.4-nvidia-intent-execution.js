'use strict';

const { NvidiaProvider } = require('./v2.4-nvidia-provider');
const { executeBrainStage } = require('./v2.4-ai-production-brain');

function createNvidiaIntentExecutor(options = {}) {
  const provider = new NvidiaProvider(options);
  return ({ idea, validate, repair }) => executeBrainStage({
    stage: 'INTENT',
    artifacts: { IDEA: { value: idea } },
    provider,
    validate,
    repair
  });
}

module.exports = { createNvidiaIntentExecutor };
