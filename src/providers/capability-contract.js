'use strict';

const CAPABILITIES = Object.freeze({
  TEXT_GENERATION: 'text_generation',
  IMAGE_GENERATION: 'image_generation',
  IMAGE_EDITING: 'image_editing',
  VIDEO_GENERATION: 'video_generation',
});

const ALIASES = Object.freeze({
  'text-generation': CAPABILITIES.TEXT_GENERATION,
  'image-generation': CAPABILITIES.IMAGE_GENERATION,
  'image-editing': CAPABILITIES.IMAGE_EDITING,
  'video-generation': CAPABILITIES.VIDEO_GENERATION,
});

function normalizeCapability(capability = CAPABILITIES.TEXT_GENERATION) {
  const normalized = ALIASES[capability] || capability;
  if (!Object.values(CAPABILITIES).includes(normalized)) {
    throw new Error(`UNSUPPORTED_CAPABILITY:${capability}`);
  }
  return normalized;
}

module.exports = { CAPABILITIES, normalizeCapability };
