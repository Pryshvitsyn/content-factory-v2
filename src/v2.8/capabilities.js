'use strict';

const CAPABILITIES = Object.freeze({
  TEXT_TO_VIDEO: 'TEXT_TO_VIDEO',
  IMAGE_TO_VIDEO: 'IMAGE_TO_VIDEO',
  REFERENCE_TO_VIDEO: 'REFERENCE_TO_VIDEO',
  VIDEO_TO_VIDEO: 'VIDEO_TO_VIDEO',
  TEXT_TO_IMAGE: 'TEXT_TO_IMAGE',
  IMAGE_TO_IMAGE: 'IMAGE_TO_IMAGE',
  SPEECH: 'SPEECH',
  MUSIC: 'MUSIC',
  FAST_RENDER: 'FAST_RENDER',
});

const LEGACY = Object.freeze({
  'video-generation': CAPABILITIES.TEXT_TO_VIDEO,
  'image-generation': CAPABILITIES.TEXT_TO_IMAGE,
  'speech-generation': CAPABILITIES.SPEECH,
  'audio-generation': CAPABILITIES.MUSIC,
});

function normalizeCapability(value) {
  const raw = String(value || '').trim();
  const legacy = LEGACY[raw.toLowerCase().replace(/_/g, '-')];
  const normalized = legacy || raw.toUpperCase().replace(/[ -]+/g, '_');
  if (!Object.hasOwn(CAPABILITIES, normalized)) {
    const error = new Error(`Unsupported canonical capability '${value}'`);
    error.code = 'CAPABILITY_UNSUPPORTED';
    throw error;
  }
  return normalized;
}

module.exports = { CAPABILITIES, LEGACY, normalizeCapability };
