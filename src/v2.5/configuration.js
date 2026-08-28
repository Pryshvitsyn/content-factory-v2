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

function positiveInteger(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new V25ConfigurationError('V25_CONFIGURATION_INVALID', `${name} must be a positive integer`);
  return parsed;
}

function baseUrl(value) {
  const parsed = new URL(required('MPT_BASE_URL', value));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new V25ConfigurationError('V25_CONFIGURATION_INVALID', 'MPT_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment');
  }
  return parsed.toString().replace(/\/$/, '');
}

function resolveV25Configuration(env = process.env, input = null) {
  if (!['true','false'].includes(env.LIVE_PAID_GENERATION)) {
    throw new V25ConfigurationError('LIVE_PAID_GATE_REQUIRED', 'LIVE_PAID_GENERATION must be explicitly true or false');
  }
  const inputMode = input?.renderMode || 'QUALITY';
  const renderMode = String(env.RENDER_MODE || inputMode).toUpperCase();
  if (!['FAST', 'QUALITY'].includes(renderMode)) {
    throw new V25ConfigurationError('LIVE_RENDER_MODE_INVALID', 'RENDER_MODE must be FAST or QUALITY');
  }
  if (input && renderMode !== inputMode) {
    throw new V25ConfigurationError('LIVE_RENDER_MODE_CONFLICT', 'RENDER_MODE must match the production input render_mode');
  }
  const common = {
    live: env.LIVE_PAID_GENERATION === 'true',
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    storageRoot: required('CONTENT_FACTORY_STORAGE_ROOT', env.CONTENT_FACTORY_STORAGE_ROOT),
    inputFile: required('REAL_PRODUCTION_INPUT', env.REAL_PRODUCTION_INPUT),
    renderMode,
    semanticVisualQaEnforced: input?.productionNamespace === 'v2.7-operator'
      || env.SEMANTIC_VISUAL_ENABLED !== undefined,
  };
  if (renderMode === 'FAST') {
    if (!['true', 'false'].includes(env.MPT_ENABLED)) {
      throw new V25ConfigurationError('FAST_RENDERER_GATE_REQUIRED', 'MPT_ENABLED must be explicitly true or false for FAST rendering');
    }
    const renderer = String(env.FAST_RENDERER || input?.fastRender?.renderer || 'moneyprinterturbo').toLowerCase();
    if (input?.fastRender?.renderer && renderer !== input.fastRender.renderer) {
      throw new V25ConfigurationError('FAST_RENDERER_CONFLICT', 'FAST_RENDERER must match fast_render.renderer');
    }
    if (env.MPT_AUTO_PUBLISH_DISABLED !== 'true') {
      throw new V25ConfigurationError('FAST_PUBLICATION_GATE_REQUIRED',
        'MPT_AUTO_PUBLISH_DISABLED=true is required; the MPT service must have upload_post_enabled=false and upload_post_auto_upload=false');
    }
    return Object.freeze({
      ...common,
      provider: renderer,
      model: env.MPT_VERSION || 'v1.3.3',
      audioProvider: null,
      audioModel: null,
      workerId: env.LIVE_PRODUCTION_WORKER_ID || `v2.6-fast-cli:${process.pid}`,
      fastRenderer: Object.freeze({
        renderer,
        enabled: env.MPT_ENABLED === 'true',
        baseUrl: baseUrl(env.MPT_BASE_URL),
        apiKey: typeof env.MPT_API_KEY === 'string' && env.MPT_API_KEY ? env.MPT_API_KEY : null,
        version: env.MPT_VERSION || 'v1.3.3',
        requestTimeoutMs: positiveInteger('MPT_REQUEST_TIMEOUT_MS', env.MPT_REQUEST_TIMEOUT_MS, 15000),
        pollIntervalMs: positiveInteger('MPT_POLL_INTERVAL_MS', env.MPT_POLL_INTERVAL_MS, 2000),
        maxWaitMs: positiveInteger('MPT_MAX_WAIT_MS', env.MPT_MAX_WAIT_MS, 900000),
        maxOutputBytes: positiveInteger('MPT_MAX_OUTPUT_BYTES', env.MPT_MAX_OUTPUT_BYTES, 268435456),
        healthcheck: env.MPT_HEALTHCHECK !== 'false',
        autoPublishDisabled: true,
      }),
    });
  }
  const selectedVideoProvider = input?.qualityVideoProfile?.provider || 'replicate';
  if ((env.VIDEO_PROVIDER || selectedVideoProvider) !== selectedVideoProvider) {
    throw new V25ConfigurationError('LIVE_PROVIDER_MISMATCH', 'VIDEO_PROVIDER must match the immutable production provider selection');
  }
  const selectedAudioProvider = input == null ? 'openai-media'
    : input.voiceover?.enabled ? (input.mediaStack?.audio?.voice?.provider === 'elevenlabs' ? 'elevenlabs' : 'openai-media') : 'none';
  if ((env.AUDIO_PROVIDER || selectedAudioProvider) !== selectedAudioProvider) {
    throw new V25ConfigurationError('LIVE_AUDIO_PROVIDER_MISMATCH', 'AUDIO_PROVIDER must match the immutable production voice selection');
  }
  return Object.freeze({
    ...common,
    provider: selectedVideoProvider,
    model: input?.qualityVideoProfile?.model || env.REPLICATE_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
    adapterFamily: input?.qualityVideoProfile?.adapterFamily || (selectedVideoProvider === 'replicate' ? 'replicate-wan' : null),
    audioProvider: selectedAudioProvider,
    audioModel: input?.mediaStack?.audio?.voice?.model || env.OPENAI_SPEECH_MODEL || DEFAULT_SPEECH_MODEL,
    workerId: env.LIVE_PRODUCTION_WORKER_ID || `v2.5-real-cli:${process.pid}`,
  });
}

function assertPaidCredentials({ config, input, env = process.env }) {
  if (!config.live) return;
  if (config.renderMode === 'FAST') {
    if (!config.fastRenderer?.enabled) {
      throw new V25ConfigurationError('FAST_RENDERER_DISABLED', 'MPT_ENABLED=true is required for explicit FAST execution');
    }
    return;
  }
  const videoProvider = input.qualityVideoProfile?.provider || 'replicate';
  const credentialNames = { replicate: ['REPLICATE_API_TOKEN'], fal: ['FAL_KEY'], runway: ['RUNWAYML_API_SECRET'],
    google: ['GOOGLE_API_KEY','GEMINI_API_KEY'], luma: ['LUMA_API_KEY'],
    alibaba: ['DASHSCOPE_API_KEY','ALIBABA_MODEL_STUDIO_WORKSPACE_ID','ALIBABA_MODEL_STUDIO_REGION'] };
  const videoCredentialNames = credentialNames[videoProvider] || [];
  const videoCredentialsReady = videoProvider === 'alibaba'
    ? videoCredentialNames.every((name) => Boolean(env[name]))
    : videoCredentialNames.some((name) => Boolean(env[name]));
  if (input.assetPlan.assets.some((asset) => asset.kind === 'video') && !videoCredentialsReady) {
    throw new V25ConfigurationError(videoProvider === 'replicate' ? 'LIVE_REPLICATE_TOKEN_REQUIRED' : 'CREDENTIALS_MISSING',
      `Credentials are required for explicit ${videoProvider} video execution`);
  }
  const voiceProvider = input.mediaStack?.audio?.voice?.provider || 'openai';
  if (input.assetPlan.assets.some((asset) => asset.kind === 'voice')
    && !(voiceProvider === 'elevenlabs' ? env.ELEVENLABS_API_KEY : env.OPENAI_API_KEY)) {
    throw new V25ConfigurationError('LIVE_AUDIO_TOKEN_REQUIRED', `${voiceProvider} credentials are required only for explicit paid voice execution`);
  }
}

module.exports = { V25ConfigurationError, assertPaidCredentials, resolveV25Configuration };
