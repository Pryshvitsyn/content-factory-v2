'use strict';

const { ProviderGateway } = require('./provider-gateway');
const { createNvidiaProvider } = require('./nvidia-provider');
const { createOpenAIMediaProvider } = require('./openai-media-provider');
const { ReplicateWanVideoAdapter } = require('./replicate-wan-video-adapter');

function createDefaultProviderGateway({
  nvidia = {},
  openai = {},
  replicate = {},
  priorities = { nvidia: 10, replicate: 20, 'openai-media': 30 },
  routing = {},
  videoProvider = process.env.VIDEO_PROVIDER || null,
} = {}) {
  const providers = { nvidia: createNvidiaProvider(nvidia) };
  if (replicate.enabled !== false && (replicate.apiToken || process.env.REPLICATE_API_TOKEN)) {
    providers.replicate = new ReplicateWanVideoAdapter(replicate);
  }
  if (openai.enabled !== false && (openai.client || openai.apiKey || process.env.OPENAI_API_KEY)) {
    providers['openai-media'] = createOpenAIMediaProvider(openai);
  }
  const effectivePriorities = { ...priorities };
  if (videoProvider) {
    if (!providers[videoProvider]) throw new Error(`Configured VIDEO_PROVIDER '${videoProvider}' is not available`);
    const videoProviders = [videoProvider, ...['nvidia', 'replicate'].filter((name) => name !== videoProvider && providers[name])];
    effectivePriorities['video-generation'] = videoProviders;
    effectivePriorities['media:video'] = videoProviders;
  }
  return new ProviderGateway({
    providers,
    priorities: effectivePriorities,
    routing,
  });
}

module.exports = { createDefaultProviderGateway };
