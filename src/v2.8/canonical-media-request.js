'use strict';

const { CAPABILITIES, normalizeCapability } = require('./capabilities');
const { DEFAULT_NEGATIVE_INTENT, translateProviderPrompt } = require('../v2.9/negative-intent');

class CanonicalMediaRequestError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = 'CanonicalMediaRequestError'; this.code = code; this.details = details;
  }
}

function array(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function references(raw = {}) {
  return Object.freeze({
    firstFrame: raw.firstFrame || raw.first_frame || null,
    lastFrame: raw.lastFrame || raw.last_frame || null,
    characterImages: array(raw.characterImages || raw.character_images),
    styleImages: array(raw.styleImages || raw.style_images),
    referenceVideos: array(raw.referenceVideos || raw.reference_videos),
  });
}

function hasReferences(value) {
  return Boolean(value.firstFrame || value.lastFrame || value.characterImages.length
    || value.styleImages.length || value.referenceVideos.length);
}

function createCanonicalMediaRequest(raw = {}) {
  const capability = normalizeCapability(raw.capability || CAPABILITIES.TEXT_TO_VIDEO);
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt && capability !== CAPABILITIES.FAST_RENDER) {
    throw new CanonicalMediaRequestError('CANONICAL_PROMPT_REQUIRED', 'Canonical media prompt is required');
  }
  const durationSeconds = raw.durationSeconds == null ? null : Number(raw.durationSeconds);
  if (durationSeconds != null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
    throw new CanonicalMediaRequestError('UNSUPPORTED_DURATION', 'durationSeconds must be positive');
  }
  const refs = references(raw.references);
  if (hasReferences(refs) && capability === CAPABILITIES.TEXT_TO_VIDEO) {
    throw new CanonicalMediaRequestError('CAPABILITY_UNSUPPORTED', 'Reference media requires IMAGE_TO_VIDEO, REFERENCE_TO_VIDEO, or VIDEO_TO_VIDEO');
  }
  const selection = raw.providerSelection || {};
  if (!selection.provider || !selection.model || !selection.profile) {
    throw new CanonicalMediaRequestError('PROVIDER_SELECTION_REQUIRED', 'provider, model, and profile are required');
  }
  const seed = raw.seed == null ? null : Number(raw.seed);
  if (seed != null && (!Number.isInteger(seed) || seed < 0)) {
    throw new CanonicalMediaRequestError('CANONICAL_SEED_INVALID', 'seed must be a non-negative integer');
  }
  return Object.freeze({
    schemaVersion: '2.8', capability, prompt, canonicalPrompt: prompt,
    providerPrompt: typeof raw.providerPrompt === 'string' && raw.providerPrompt.trim() ? raw.providerPrompt.trim() : prompt,
    negativeIntent: Object.freeze(structuredClone(raw.negativeIntent || DEFAULT_NEGATIVE_INTENT)),
    negativePrompt: typeof raw.negativePrompt === 'string' ? raw.negativePrompt.trim() : '',
    durationSeconds, aspectRatio: raw.aspectRatio || null, resolution: raw.resolution || null,
    references: refs, audio: Object.freeze({ requested: raw.audio?.requested === true }),
    camera: Object.freeze({ ...(raw.camera || {}) }), continuity: Object.freeze({ ...(raw.continuity || {}) }),
    seed, providerSelection: Object.freeze({ provider: String(selection.provider).toLowerCase(),
      vendor: selection.vendor || null, model: selection.model, modelVersion: selection.modelVersion || null,
      profile: String(selection.profile).toUpperCase() }),
    resolvedSettings: Object.freeze({ ...(raw.resolvedSettings || {}) }),
  });
}

function fromAsset(asset) {
  const requirements = asset?.generation_requirements || {};
  const refs = requirements.references || {};
  let capability = requirements.capability || CAPABILITIES.TEXT_TO_VIDEO;
  if (asset?.kind === 'voice') capability = CAPABILITIES.SPEECH;
  else if (asset?.kind === 'image') capability = CAPABILITIES.TEXT_TO_IMAGE;
  else if (refs.reference_videos?.length || refs.referenceVideos?.length) capability = CAPABILITIES.VIDEO_TO_VIDEO;
  else if (refs.character_images?.length || refs.style_images?.length || refs.characterImages?.length || refs.styleImages?.length) capability = CAPABILITIES.REFERENCE_TO_VIDEO;
  else if (refs.first_frame || refs.last_frame || refs.firstFrame || refs.lastFrame) capability = CAPABILITIES.IMAGE_TO_VIDEO;
  const prompt = requirements.prompt || asset?.description;
  const selection = requirements.provider_selection || { provider: requirements.provider,
    vendor: requirements.vendor, model: requirements.model, modelVersion: requirements.model_version,
    profile: requirements.profile || 'STANDARD' };
  const translated = translateProviderPrompt({ canonicalPrompt: prompt,
    negativeIntent: requirements.negative_intent || DEFAULT_NEGATIVE_INTENT,
    provider: selection.provider, model: selection.model });
  return createCanonicalMediaRequest({
    capability, prompt, providerPrompt: translated.providerPrompt, negativeIntent: translated.negativeIntent,
    negativePrompt: requirements.negative_prompt, durationSeconds: (requirements.target_clip_duration_ms || 0) / 1000 || null,
    aspectRatio: requirements.aspect_ratio, resolution: requirements.resolution, references: refs,
    audio: { requested: requirements.generate_audio === true }, camera: requirements.camera,
    continuity: requirements.continuity, seed: requirements.seed,
    providerSelection: selection,
    resolvedSettings: requirements.resolved_settings || requirements,
  });
}

module.exports = { CanonicalMediaRequestError, createCanonicalMediaRequest, fromAsset, hasReferences };
