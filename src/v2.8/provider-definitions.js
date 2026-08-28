'use strict';

const { CAPABILITIES: C } = require('./capabilities');

const PROFILES = Object.freeze({
  ECONOMY: { resolution: '720p', quality: false, fast: true, audioBehavior: 'external', promptOptimization: false },
  STANDARD: { resolution: '720p', quality: true, fast: false, audioBehavior: 'external', promptOptimization: true },
  PREMIUM: { resolution: '1080p', quality: true, fast: false, audioBehavior: 'external', promptOptimization: true },
});

function profile(names, overrides = {}) {
  return Object.fromEntries(names.map((name) => [name, { ...PROFILES[name], ...(overrides[name] || {}) }]));
}

const PROVIDERS = Object.freeze([
  { id: 'replicate', displayName: 'Replicate', type: 'AGGREGATOR', credentialEnv: 'REPLICATE_API_TOKEN', adapterFamily: 'replicate-video', productionStatus: 'SUPPORTED' },
  { id: 'fal', displayName: 'fal.ai', type: 'AGGREGATOR', credentialEnv: 'FAL_KEY', adapterFamily: 'fal-video', productionStatus: 'SUPPORTED' },
  { id: 'runway', displayName: 'Runway', type: 'DIRECT', credentialEnv: 'RUNWAYML_API_SECRET', adapterFamily: 'runway-video', productionStatus: 'SUPPORTED' },
  { id: 'google', displayName: 'Google Veo', type: 'DIRECT', credentialEnv: 'GOOGLE_API_KEY', credentialAliases: ['GEMINI_API_KEY'], adapterFamily: 'google-veo', productionStatus: 'SUPPORTED' },
  { id: 'luma', displayName: 'Luma Dream Machine', type: 'DIRECT', credentialEnv: 'LUMA_API_KEY', adapterFamily: 'luma-video', productionStatus: 'SUPPORTED' },
  { id: 'openai', displayName: 'OpenAI', type: 'DIRECT', credentialEnv: 'OPENAI_API_KEY', adapterFamily: 'openai-media', productionStatus: 'SUPPORTED' },
  { id: 'alibaba', displayName: 'Alibaba Model Studio', type: 'DIRECT', credentialEnv: 'DASHSCOPE_API_KEY',
    requiredEnv: ['ALIBABA_MODEL_STUDIO_WORKSPACE_ID','ALIBABA_MODEL_STUDIO_REGION'], adapterFamily: 'dashscope-video', productionStatus: 'SUPPORTED' },
  { id: 'elevenlabs', displayName: 'ElevenLabs', type: 'DIRECT', credentialEnv: 'ELEVENLABS_API_KEY', adapterFamily: 'elevenlabs-tts', productionStatus: 'SUPPORTED' },
  { id: 'moneyprinterturbo', displayName: 'MoneyPrinterTurbo', type: 'LOCAL', credentialEnv: null, adapterFamily: 'mpt-fast', productionStatus: 'SUPPORTED' },
]);

const MODELS = Object.freeze([
  { provider: 'replicate', vendor: 'wan-video', modelFamily: 'WAN_2_2', providerModelId: 'wan-video/wan-2.2-t2v-fast', modelId: 'wan-video/wan-2.2-t2v-fast', displayName: 'Wan 2.2 T2V Fast', adapterFamily: 'replicate-wan', capabilities: [C.TEXT_TO_VIDEO], supportStatus: 'SUPPORTED',
    profiles: profile(['ECONOMY','STANDARD'], { ECONOMY: { resolution: '480p', numFrames: 81, framesPerSecond: 16, goFast: true, optimizePrompt: false, interpolateOutput: false, sampleShift: 12 }, STANDARD: { resolution: '720p', numFrames: 121, framesPerSecond: 24, goFast: false, optimizePrompt: true, interpolateOutput: true, sampleShift: 12 } }),
    constraints: { durations: [5], resolutions: ['480p','720p'], aspectRatios: ['9:16','16:9'] }, costStatus: 'UNKNOWN', relativeTier: 'ECONOMY' },
  { provider: 'replicate', vendor: 'bytedance', modelId: 'bytedance/seedance-1-pro', displayName: 'Seedance 1 Pro', adapterFamily: 'replicate-video', capabilities: [C.TEXT_TO_VIDEO], profiles: profile(['STANDARD','PREMIUM']), constraints: { durations: [5,10], resolutions: ['720p','1080p'], aspectRatios: ['9:16','16:9'] }, experimental: true, costStatus: 'UNKNOWN' },
  { provider: 'replicate', vendor: 'kwai', modelId: 'kwaivgi/kling-v2.1', displayName: 'Kling 2.1', adapterFamily: 'replicate-video', capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO], profiles: profile(['STANDARD','PREMIUM']), experimental: true, costStatus: 'UNKNOWN' },
  { provider: 'replicate', vendor: 'minimax', modelId: 'minimax/video-01', displayName: 'Hailuo Video 01', adapterFamily: 'replicate-video', capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO], profiles: profile(['ECONOMY','STANDARD']), experimental: true, costStatus: 'UNKNOWN' },
  { provider: 'fal', vendor: 'bytedance', modelId: 'bytedance/seedance-2.0/text-to-video', displayName: 'ByteDance Seedance 2.0', adapterFamily: 'fal-video', capabilities: [C.TEXT_TO_VIDEO], profiles: profile(['STANDARD','PREMIUM'], { STANDARD: { duration: '5', generateAudio: false }, PREMIUM: { duration: '5', generateAudio: false, bitrateMode: 'high' } }), constraints: { durations: [5], resolutions: ['720p','1080p'], aspectRatios: ['9:16','16:9'] }, costStatus: 'UNKNOWN', relativeTier: 'PREMIUM' },
  { provider: 'fal', vendor: 'bytedance', modelId: 'bytedance/seedance-2.0/reference-to-video', displayName: 'Seedance 2.0 Reference', adapterFamily: 'fal-video', capabilities: [C.REFERENCE_TO_VIDEO,C.VIDEO_TO_VIDEO], profiles: profile(['STANDARD','PREMIUM']), constraints: { durations: [5], resolutions: ['720p','1080p'], aspectRatios: ['9:16','16:9'] }, experimental: true, costStatus: 'UNKNOWN' },
  { provider: 'replicate', vendor: 'alibaba', modelFamily: 'WAN_3', providerModelId: 'alibaba/wan-3', modelId: 'alibaba/wan-3', displayName: 'Wan 3', adapterFamily: 'replicate-wan-3',
    capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO,C.AUDIO_DISABLE_SUPPORTED], supportStatus: 'SUPPORTED',
    profiles: profile(['ECONOMY','STANDARD','PREMIUM'], { ECONOMY: { resolution: '480p', duration: 5, enablePromptExpansion: false }, STANDARD: { resolution: '720p', duration: 5, enablePromptExpansion: true }, PREMIUM: { resolution: '1080p', duration: 5, enablePromptExpansion: true } }),
    constraints: { durationRange: [2,30], resolutions: ['480p','720p','1080p'], aspectRatios: ['adaptive','9:16','16:9','1:1','4:3','3:4'] }, costStatus: 'VERIFIED', relativeTier: 'STANDARD' },
  { provider: 'alibaba', vendor: 'alibaba', modelFamily: 'WAN_3', providerModelId: 'wan3.0-video', modelId: 'wan3.0-video', displayName: 'Wan 3.0 Video', adapterFamily: 'dashscope-video',
    capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO,C.REFERENCE_TO_VIDEO,C.VIDEO_TO_VIDEO,C.VIDEO_EXTENSION,C.NATIVE_AUDIO,C.NATIVE_DIALOGUE,C.NATIVE_AMBIENCE,C.AUDIO_DISABLE_SUPPORTED,C.HYBRID_AUDIO_SUPPORTED], supportStatus: 'SUPPORTED',
    profiles: profile(['ECONOMY','STANDARD','PREMIUM'], { ECONOMY: { resolution: '480p', duration: 5, generateAudio: false }, STANDARD: { resolution: '720p', duration: 5, generateAudio: false }, PREMIUM: { resolution: '1080p', duration: 5, generateAudio: true } }),
    constraints: { durationRange: [1,30], resolutions: ['480p','720p','1080p'], aspectRatios: ['9:16','16:9','1:1','4:3','3:4'] }, costStatus: 'PROMOTIONAL', relativeTier: 'STANDARD' },
  { provider: 'replicate', vendor: 'bytedance', modelFamily: 'SEEDANCE_2_5', providerModelId: 'bytedance/seedance-2.5', modelId: 'bytedance/seedance-2.5', displayName: 'Seedance 2.5', adapterFamily: 'replicate-seedance-2.5',
    capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO,C.REFERENCE_TO_VIDEO,C.VIDEO_TO_VIDEO,C.VIDEO_EXTENSION,C.NATIVE_AUDIO,C.NATIVE_DIALOGUE,C.NATIVE_AMBIENCE,C.AUDIO_DISABLE_SUPPORTED,C.HYBRID_AUDIO_SUPPORTED], supportStatus: 'SUPPORTED',
    profiles: profile(['ECONOMY','STANDARD','PREMIUM'], { ECONOMY: { resolution: '480p', duration: 5, generateAudio: false }, STANDARD: { resolution: '720p', duration: 5, generateAudio: false }, PREMIUM: { resolution: '1080p', duration: 5, generateAudio: true } }),
    constraints: { durationRange: [1,30], resolutions: ['480p','720p','1080p'], aspectRatios: ['adaptive','9:16','16:9','1:1','4:3','3:4'] }, costStatus: 'UNKNOWN', relativeTier: 'STANDARD' },
  { provider: 'fal', vendor: 'bytedance', modelFamily: 'SEEDANCE_2_5', providerModelId: 'bytedance/seedance-2.5/text-to-video', modelId: 'bytedance/seedance-2.5/text-to-video', displayName: 'Seedance 2.5', adapterFamily: 'fal-video',
    capabilities: [C.TEXT_TO_VIDEO,C.NATIVE_AUDIO,C.NATIVE_DIALOGUE,C.NATIVE_AMBIENCE,C.AUDIO_DISABLE_SUPPORTED,C.HYBRID_AUDIO_SUPPORTED], supportStatus: 'SUPPORTED',
    profiles: profile(['ECONOMY','STANDARD','PREMIUM'], { ECONOMY: { resolution: '480p', duration: '5', generateAudio: false }, STANDARD: { resolution: '720p', duration: '5', generateAudio: false }, PREMIUM: { resolution: '1080p', duration: '5', generateAudio: true, bitrateMode: 'high' } }),
    constraints: { durationRange: [4,30], resolutions: ['480p','720p','1080p'], aspectRatios: ['auto','9:16','16:9','1:1','4:3','3:4'] }, costStatus: 'UNKNOWN', relativeTier: 'STANDARD' },
  { provider: 'runway', vendor: 'runway', modelFamily: 'RUNWAY_GEN_4_5', providerModelId: 'gen4.5', modelId: 'gen4.5', displayName: 'Runway Gen-4.5', adapterFamily: 'runway-video', capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO,C.AUDIO_DISABLE_SUPPORTED], supportStatus: 'SUPPORTED', profiles: profile(['STANDARD'], { STANDARD: { resolution: '720p', duration: 5 } }), constraints: { durations: [5], resolutions: ['720p'], aspectRatios: ['9:16','16:9'] }, costStatus: 'UNKNOWN', relativeTier: 'STANDARD' },
  { provider: 'google', vendor: 'google', modelFamily: 'VEO_3_1', providerModelId: 'veo-3.1-generate-preview', modelId: 'veo-3.1-generate-preview', displayName: 'Google Veo 3.1', adapterFamily: 'google-veo', capabilities: [C.TEXT_TO_VIDEO,C.NATIVE_AUDIO,C.NATIVE_DIALOGUE,C.NATIVE_AMBIENCE,C.AUDIO_DISABLE_SUPPORTED], supportStatus: 'SUPPORTED', profiles: profile(['PREMIUM'], { PREMIUM: { resolution: '720p', duration: 8, generateAudio: true } }), constraints: { durations: [8], resolutions: ['720p','1080p','4k'], aspectRatios: ['9:16','16:9'] }, costStatus: 'UNKNOWN', relativeTier: 'PREMIUM' },
  { provider: 'luma', vendor: 'luma', modelId: 'ray-2', displayName: 'Luma Ray 2', adapterFamily: 'luma-video', capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO], profiles: profile(['STANDARD','PREMIUM'], { STANDARD: { duration: '5s', resolution: '720p' }, PREMIUM: { duration: '5s', resolution: '1080p' } }), constraints: { durations: [5,9], resolutions: ['720p','1080p'], aspectRatios: ['9:16','16:9'] }, costStatus: 'UNKNOWN', relativeTier: 'STANDARD' },
  { provider: 'openai', vendor: 'openai', modelFamily: 'OPENAI_TTS', providerModelId: 'gpt-4o-mini-tts', modelId: 'gpt-4o-mini-tts', displayName: 'OpenAI TTS', adapterFamily: 'openai-media', capabilities: [C.SPEECH], supportStatus: 'SUPPORTED', profiles: profile(['STANDARD']), costStatus: 'UNKNOWN' },
  { provider: 'elevenlabs', vendor: 'elevenlabs', modelFamily: 'ELEVENLABS_TTS', providerModelId: 'eleven_v3', modelId: 'eleven_v3', displayName: 'Eleven v3', adapterFamily: 'elevenlabs-tts', capabilities: [C.SPEECH], supportStatus: 'SUPPORTED', profiles: profile(['STANDARD']), costStatus: 'VERIFIED' },
  { provider: 'moneyprinterturbo', vendor: 'moneyprinterturbo', modelId: 'v1.3.3', displayName: 'MoneyPrinterTurbo Fast', adapterFamily: 'mpt-fast', capabilities: [C.FAST_RENDER], profiles: profile(['ECONOMY']), costStatus: 'UNKNOWN' },
]);

module.exports = { PROVIDERS, MODELS, PROFILES };
