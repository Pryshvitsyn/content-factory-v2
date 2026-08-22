'use strict';

const { DEFAULT_MODEL: NVIDIA_TEXT_MODEL } = require('../../../src/providers/nvidia-adapter');
const { DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL } = require('../../../src/providers/openai-media-provider');
const { DEFAULT_MODEL: REPLICATE_VIDEO_MODEL } = require('../../../src/providers/replicate-wan-video-adapter');

function status(configured) {
  return configured ? 'CONFIGURED_NOT_PROBED' : 'UNAVAILABLE';
}

function describeProviders(env = process.env) {
  const nvidia = Boolean(env.NVIDIA_API_KEY);
  const replicate = Boolean(env.REPLICATE_API_TOKEN);
  const openai = Boolean(env.OPENAI_API_KEY);
  const preferredVideo = env.VIDEO_PROVIDER || 'nvidia';
  return [
    { capability: 'TEXT / REASONING', provider: 'NVIDIA', model: env.NVIDIA_MODEL || NVIDIA_TEXT_MODEL,
      enabled: true, configured: nvidia, availability: status(nvidia), route: 'primary' },
    { capability: 'VIDEO', provider: 'Replicate', model: env.REPLICATE_VIDEO_MODEL || REPLICATE_VIDEO_MODEL,
      enabled: replicate, configured: replicate, availability: status(replicate), route: preferredVideo === 'replicate' ? 'primary' : 'alternative' },
    { capability: 'VIDEO', provider: 'NVIDIA', model: env.NVIDIA_VIDEO_MODEL || 'nvidia/cosmos3-nano',
      enabled: true, configured: nvidia, availability: status(nvidia), route: preferredVideo === 'nvidia' ? 'primary' : 'alternative' },
    { capability: 'IMAGE', provider: openai ? 'OpenAI' : 'Unavailable', model: openai ? env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL : null,
      enabled: openai, configured: openai, availability: status(openai), route: openai ? 'primary' : null },
    { capability: 'SPEECH', provider: openai ? 'OpenAI' : 'Unavailable', model: openai ? env.OPENAI_SPEECH_MODEL || DEFAULT_SPEECH_MODEL : null,
      enabled: openai, configured: openai, availability: status(openai), route: openai ? 'primary' : null },
  ];
}

module.exports = { describeProviders };
