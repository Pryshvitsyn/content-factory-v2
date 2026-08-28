'use strict';

const { CAPABILITIES: C } = require('../v2.8/capabilities');

const AUDIO_STRATEGIES = Object.freeze(['EXTERNAL_VOICE','NATIVE_VIDEO_AUDIO','HYBRID','NO_VOICE','NO_AUDIO']);
const MASTER_PROFILES = Object.freeze({
  SOCIAL_VERTICAL: Object.freeze({ container: 'mp4', codec: 'h264', width: 1080, height: 1920, framesPerSecond: 30, aspectRatio: '9:16', audioCodec: 'aac' }),
  SOCIAL_LANDSCAPE: Object.freeze({ container: 'mp4', codec: 'h264', width: 1920, height: 1080, framesPerSecond: 30, aspectRatio: '16:9', audioCodec: 'aac' }),
});
const MEDIA_STACK_PRESETS = Object.freeze({
  ECONOMY: Object.freeze({ video: { provider: 'replicate', modelFamily: 'WAN_2_2', model: 'wan-video/wan-2.2-t2v-fast', profile: 'ECONOMY' },
    audioStrategy: 'EXTERNAL_VOICE', voice: { provider: 'openai', model: 'gpt-4o-mini-tts', voiceId: 'alloy' }, masterProfile: 'SOCIAL_VERTICAL' }),
  STANDARD: Object.freeze({ video: { provider: 'runway', modelFamily: 'RUNWAY_GEN_4_5', model: 'gen4.5', profile: 'STANDARD' },
    audioStrategy: 'EXTERNAL_VOICE', voice: { provider: 'openai', model: 'gpt-4o-mini-tts', voiceId: 'alloy' }, masterProfile: 'SOCIAL_VERTICAL' }),
  PREMIUM: Object.freeze({ video: { provider: 'google', modelFamily: 'VEO_3_1', model: 'veo-3.1-generate-preview', profile: 'PREMIUM' },
    audioStrategy: 'NATIVE_VIDEO_AUDIO', voice: null, masterProfile: 'SOCIAL_VERTICAL' }),
  CUSTOM: Object.freeze({}),
});

class MediaStackError extends Error {
  constructor(code, message, details = null) { super(message); this.name = 'MediaStackError'; this.code = code; this.status = 409; this.details = details; }
}

function defined(value) { return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== '')); }
function mergeSelection(operator, brand, preset) { return { ...defined(preset), ...defined(brand), ...defined(operator) }; }
function immutable(value) { return Object.freeze(structuredClone(value)); }

function brandMediaPreferences(brand = {}) {
  if (brand.mediaStackPreferences || brand.media_stack_preferences) {
    return immutable(brand.mediaStackPreferences || brand.media_stack_preferences);
  }
  const record = (brand.knowledge || []).find((item) => ['MEDIA_STACK_PREFERENCES','VOICE_PREFERENCES'].includes(item.knowledgeType || item.knowledge_type));
  return immutable(record?.content || {});
}

function resolveMediaStack({ request = {}, brandPreferences = {}, catalog, semantic = {}, env = process.env } = {}) {
  if (!catalog) throw new Error('catalog is required');
  const presetName = String(request.preset || brandPreferences.preset || 'STANDARD').toUpperCase();
  const preset = MEDIA_STACK_PRESETS[presetName];
  if (!preset) throw new MediaStackError('MEDIA_PRESET_INVALID', `Unknown media preset '${presetName}'`);
  const video = mergeSelection(request.video || {
    ...(request.provider ? { provider: request.provider } : {}), ...(request.modelFamily ? { modelFamily: request.modelFamily } : {}),
    ...(request.model ? { model: request.model } : {}), ...(request.profile ? { profile: request.profile } : {}),
  }, brandPreferences.video, preset.video);
  if (!video.provider || !video.model || !video.profile) throw new MediaStackError('MEDIA_VIDEO_SELECTION_REQUIRED', 'An explicit video provider, model, and profile are required');
  const resolvedVideo = catalog.resolveSelection({ ...video, capability: request.capability || video.capability || 'TEXT_TO_VIDEO',
    durationSeconds: request.durationSeconds, resolution: request.resolution, aspectRatio: request.aspectRatio,
    allowExperimental: request.allowExperimental === true });
  if (video.modelFamily && resolvedVideo.modelFamily && video.modelFamily !== resolvedVideo.modelFamily) {
    throw new MediaStackError('MODEL_FAMILY_MISMATCH', `${resolvedVideo.model} belongs to ${resolvedVideo.modelFamily}, not ${video.modelFamily}`);
  }
  const audioStrategy = String(request.audioStrategy || brandPreferences.audioStrategy || preset.audioStrategy || 'EXTERNAL_VOICE').toUpperCase();
  if (!AUDIO_STRATEGIES.includes(audioStrategy)) throw new MediaStackError('AUDIO_STRATEGY_INVALID', `Unknown audio strategy '${audioStrategy}'`);
  const native = resolvedVideo.capabilities.includes(C.NATIVE_AUDIO);
  if (audioStrategy === 'NATIVE_VIDEO_AUDIO' && !native) throw new MediaStackError('NATIVE_AUDIO_UNSUPPORTED', `${resolvedVideo.displayName} does not support native audio`);
  if (audioStrategy === 'HYBRID' && (!native || !resolvedVideo.capabilities.includes(C.HYBRID_AUDIO_SUPPORTED))) {
    throw new MediaStackError('HYBRID_AUDIO_UNSUPPORTED', `${resolvedVideo.displayName} does not support safe hybrid audio`);
  }
  const needsVoice = ['EXTERNAL_VOICE','HYBRID'].includes(audioStrategy);
  const voice = needsVoice ? mergeSelection(request.voice || {
    ...(request.voiceProvider ? { provider: request.voiceProvider } : {}), ...(request.voiceModel ? { model: request.voiceModel } : {}),
    ...(request.voiceId ? { voiceId: request.voiceId } : {}), ...(request.voiceLanguage ? { language: request.voiceLanguage } : {}),
  }, brandPreferences.voice, preset.voice) : null;
  if (needsVoice && (!voice?.provider || !voice?.model || !voice?.voiceId)) {
    throw new MediaStackError('VOICE_SELECTION_REQUIRED', `${audioStrategy} requires an explicit voice provider, model, and voice ID`);
  }
  if (needsVoice) catalog.resolveSelection({ provider: voice.provider, model: voice.model, profile: voice.profile || 'STANDARD', capability: C.SPEECH });
  const nativeDialogue = ['NATIVE_VIDEO_AUDIO','HYBRID'].includes(audioStrategy);
  const dialogueOwner = needsVoice ? 'EXTERNAL_VOICE' : nativeDialogue ? 'VIDEO_PROVIDER' : 'NONE';
  const masterProfile = request.masterProfile || brandPreferences.masterProfile || preset.masterProfile || 'SOCIAL_VERTICAL';
  if (!MASTER_PROFILES[masterProfile]) throw new MediaStackError('MASTER_PROFILE_INVALID', `Unknown master profile '${masterProfile}'`);
  return immutable({ schemaVersion: '2.9.2', preset: presetName, resolutionOrder: ['operator','brand','preset'],
    video: resolvedVideo, audio: { strategy: audioStrategy, generateNativeAudio: nativeDialogue,
      generateExternalVoice: needsVoice, dialogueOwner, preventDuplicateNarration: true, voice: voice || null },
    semanticCritic: { provider: request.semanticProvider || semantic.provider || env.SEMANTIC_VISUAL_PROVIDER || null,
      model: request.semanticModel || semantic.model || env.SEMANTIC_VISUAL_MODEL || null },
    master: { profile: masterProfile, ...MASTER_PROFILES[masterProfile] } });
}

function publicMediaStackCatalog(catalog) {
  return immutable({ schemaVersion: '2.9.2', presets: MEDIA_STACK_PRESETS, audioStrategies: AUDIO_STRATEGIES,
    masterProfiles: MASTER_PROFILES, providers: catalog.listProviders() });
}

module.exports = { AUDIO_STRATEGIES, MASTER_PROFILES, MEDIA_STACK_PRESETS, MediaStackError, brandMediaPreferences, resolveMediaStack, publicMediaStackCatalog };
