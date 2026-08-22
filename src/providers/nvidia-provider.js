'use strict';

const { createNvidiaAdapter } = require('./nvidia-adapter');
const { createNvidiaVideoAdapter } = require('./nvidia-video-adapter');

function createNvidiaProvider(options = {}) {
  const textAdapter = options.textAdapter || createNvidiaAdapter(options);
  const videoAdapter = options.videoAdapter || createNvidiaVideoAdapter(options);

  return Object.freeze({
    provider: 'nvidia',
    model: textAdapter.model,

    modelFor({ capability } = {}) {
      if (capability === 'video-generation') return videoAdapter.model;
      if (capability === 'text-generation') return textAdapter.model;
      return null;
    },

    supports({ capability, model } = {}) {
      if (capability === 'text-generation') return !model || model === textAdapter.model;
      if (capability === 'video-generation') return videoAdapter.supports({ capability, model });
      return false;
    },

    async generate({ capability = 'text-generation', ...request } = {}) {
      if (capability === 'text-generation') return textAdapter.generate(request);
      if (capability === 'video-generation') return videoAdapter.generate(request);
      throw new Error(`NVIDIA provider does not support capability '${capability}'`);
    },
  });
}

module.exports = { createNvidiaProvider };
