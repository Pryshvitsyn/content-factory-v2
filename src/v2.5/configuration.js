'use strict';

const { DEFAULT_MODEL: DEFAULT_VIDEO_MODEL } = require('../providers/replicate-wan-video-adapter');
const { DEFAULT_SPEECH_MODEL } = require('../providers/openai-media-provider');

class V25ConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'V25ConfigurationError';
    this.code = code;
  }
}

function required(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new V25ConfigurationError('V25_CONFIGURATION_INVALID', `${name} is required`);
  return value.trim();
}

function resolveV25Configuration(env = process.env) {
  if (!['true','false'].includes(env.LIVE_PAID_GENERATION)) {
    throw new V25ConfigurationError('LIVE_PAID_GATE_REQUIRED', 'LIVE_PAID_GENERATION must be explicitly true or false');
  }
  if ((env.VIDEO_PROVIDER || 'replicate') !== 'replicate') {
    throw new V25ConfigurationError('LIVE_PROVIDER_MISMATCH', 'VIDEO_PROVIDER must be replicate for the current certified video adapter');
  }
  if ((env.AUDIO_PROVIDER || 'openai-media') !== 'openai-media') {
    throw new V25ConfigurationError('LIVE_AUDIO_PROVIDER_MISMATCH', 'AUDIO_PROVIDER must be openai-media for the current certified speech adapter');
  }
  return Object.freeze({
    live: env.LIVE_PAID_GENERATION === 'true',
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    storageRoot: required('CONTENT_FACTORY_STORAGE_ROOT', env.CONTENT_FACTORY_STORAGE_ROOT),
    inputFile: required('REAL_PRODUCTION_INPUT', env.REAL_PRODUCTION_INPUT),
    provider: 'replicate',
    model: env.REPLICATE_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
    audioProvider: 'openai-media',
    audioModel: env.OPENAI_SPEECH_MODEL || DEFAULT_SPEECH_MODEL,
    workerId: env.LIVE_PRODUCTION_WORKER_ID || `v2.5-real-cli:${process.pid}`,
  });
}

function assertPaidCredentials({ config, input, env = process.env }) {
  if (!config.live) return;
  if (input.assetPlan.assets.some((asset) => asset.kind === 'video') && !env.REPLICATE_API_TOKEN) {
    throw new V25ConfigurationError('LIVE_REPLICATE_TOKEN_REQUIRED', 'REPLICATE_API_TOKEN is required only for explicit paid video execution');
  }
  if (input.assetPlan.assets.some((asset) => asset.kind === 'voice') && !env.OPENAI_API_KEY) {
    throw new V25ConfigurationError('LIVE_AUDIO_TOKEN_REQUIRED', 'OPENAI_API_KEY is required only for explicit paid voice execution');
  }
}

module.exports = { V25ConfigurationError, assertPaidCredentials, resolveV25Configuration };
