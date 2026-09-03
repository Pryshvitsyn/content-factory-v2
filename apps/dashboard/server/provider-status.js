'use strict';

const { DEFAULT_MODEL: NVIDIA_TEXT_MODEL } = require('../../../src/providers/nvidia-adapter');
const { DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL } = require('../../../src/providers/openai-media-provider');
const { DEFAULT_MODEL: REPLICATE_VIDEO_MODEL } = require('../../../src/providers/replicate-wan-video-adapter');
const { resolveQualityVideoProfile } = require('../../../src/v2.7/quality-video-profile');

function status(configured) {
  return configured ? 'CONFIGURED_NOT_PROBED' : 'UNAVAILABLE';
}

function describeProviders(env = process.env) {
  const nvidia = Boolean(env.NVIDIA_API_KEY);
  const replicate = Boolean(env.REPLICATE_API_TOKEN);
  let qualityProfile = null; let qualityProfileError = null;
  try { qualityProfile = resolveQualityVideoProfile(env); } catch (error) { qualityProfileError = error; }
  const openai = Boolean(env.OPENAI_API_KEY);
  const preferredVideo = env.VIDEO_PROVIDER || 'nvidia';
  const mptConfigured = env.MPT_ENABLED === 'true' && Boolean(env.MPT_BASE_URL)
    && env.MPT_AUTO_PUBLISH_DISABLED === 'true';
  const semanticEnabled = env.SEMANTIC_VISUAL_ENABLED === 'true';
  const semanticProvider = String(env.SEMANTIC_VISUAL_PROVIDER || '').toLowerCase();
  const semanticModel = env.SEMANTIC_VISUAL_MODEL || null;
  const semanticConfigured = semanticEnabled && semanticProvider === 'openai' && Boolean(semanticModel) && openai;
  const semanticPaidAuthorized = semanticConfigured && env.LIVE_PAID_VISUAL_EVALUATION === 'true';
  return [
    { mode: 'FAST', capability: 'FAST RENDERER', provider: 'MoneyPrinterTurbo', model: env.MPT_VERSION || 'v1.3.3',
      enabled: env.MPT_ENABLED === 'true', configured: mptConfigured, availability: status(mptConfigured),
      route: env.FAST_RENDERER === 'moneyprinterturbo' ? 'primary' : 'optional', captionsRendered: true,
      publication: 'AUTO_PUBLISH_DISABLED' },
    { capability: 'TEXT / REASONING', provider: 'NVIDIA', model: env.NVIDIA_MODEL || NVIDIA_TEXT_MODEL,
      enabled: true, configured: nvidia, availability: status(nvidia), route: 'primary' },
    { mode: 'QUALITY', capability: 'VIDEO', provider: 'Replicate',
      model: qualityProfile?.model || env.QUALITY_VIDEO_MODEL || null,
      enabled: replicate, configured: replicate && Boolean(qualityProfile),
      availability: status(replicate && Boolean(qualityProfile)), route: preferredVideo === 'replicate' ? 'primary' : 'alternative',
      profile: qualityProfile?.name || 'production', resolution: qualityProfile?.resolution || null,
      qualityMode: qualityProfile ? (qualityProfile.goFast ? 'FAST' : 'QUALITY') : null,
      configurationError: qualityProfileError?.code || null, legacyFallbackModel: REPLICATE_VIDEO_MODEL },
    { capability: 'VIDEO', provider: 'NVIDIA', model: env.NVIDIA_VIDEO_MODEL || 'nvidia/cosmos3-nano',
      enabled: true, configured: nvidia, availability: status(nvidia), route: preferredVideo === 'nvidia' ? 'primary' : 'alternative' },
    { capability: 'IMAGE', provider: openai ? 'OpenAI' : 'Unavailable', model: openai ? env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL : null,
      enabled: openai, configured: openai, availability: status(openai), route: openai ? 'primary' : null },
    { mode: 'QUALITY', capability: 'SPEECH', provider: openai ? 'OpenAI' : 'Unavailable', model: openai ? env.OPENAI_SPEECH_MODEL || DEFAULT_SPEECH_MODEL : null,
      enabled: openai, configured: openai, availability: status(openai), route: openai ? 'primary' : null },
    { mode: 'QUALITY', capability: 'SEMANTIC VISUAL QA', provider: semanticProvider === 'openai' ? 'OpenAI' : 'Unavailable',
      model: semanticModel, enabled: semanticEnabled, configured: semanticConfigured,
      availability: status(semanticConfigured), route: 'independent-critic', secretExposed: false,
      paidExecutionAuthorized: semanticPaidAuthorized,
      configurationStatus: !semanticEnabled ? 'DISABLED' : !semanticConfigured ? 'INVALID_CONFIGURATION'
        : semanticPaidAuthorized ? 'CONFIGURED' : 'PAID_GATE_CLOSED' },
  ];
}

module.exports = { describeProviders };
