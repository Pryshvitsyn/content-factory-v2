'use strict';

const { buildWanInput, DEFAULT_MODEL: LEGACY_FAST_MODEL } = require('../providers/replicate-wan-video-adapter');

class QualityProfileError extends Error {
  constructor(code, message) { super(message); this.name = 'QualityProfileError'; this.code = code; }
}

function bool(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!['true', 'false'].includes(String(value))) throw new QualityProfileError('QUALITY_PROFILE_INVALID', `${name} must be true or false`);
  return String(value) === 'true';
}

function integer(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) throw new QualityProfileError('QUALITY_PROFILE_INVALID', `${name} must be an integer`);
  return parsed;
}

function resolveQualityVideoProfile(env = process.env) {
  const name = String(env.QUALITY_VIDEO_PROFILE || 'production').toLowerCase();
  const legacy = name === 'legacy-fast-test';
  if (!legacy && name !== 'production') throw new QualityProfileError('QUALITY_PROFILE_INVALID', 'QUALITY_VIDEO_PROFILE must be production or legacy-fast-test');
  const model = env.QUALITY_VIDEO_MODEL || (legacy ? LEGACY_FAST_MODEL : null);
  if (!model) throw new QualityProfileError('QUALITY_MODEL_REQUIRED', 'QUALITY_VIDEO_MODEL is required for the production QUALITY profile; no model downgrade was applied');
  const provider = String(env.QUALITY_VIDEO_PROVIDER || 'replicate').toLowerCase();
  if (provider !== 'replicate') throw new QualityProfileError('QUALITY_CAPABILITY_UNAVAILABLE', `QUALITY provider ${provider} is not supported by the installed video adapter`);
  const profile = {
    name, provider, model,
    resolution: env.QUALITY_VIDEO_RESOLUTION || (legacy ? '480p' : '720p'),
    goFast: bool('QUALITY_VIDEO_GO_FAST', env.QUALITY_VIDEO_GO_FAST, legacy),
    optimizePrompt: bool('QUALITY_VIDEO_OPTIMIZE_PROMPT', env.QUALITY_VIDEO_OPTIMIZE_PROMPT, !legacy),
    interpolateOutput: bool('QUALITY_VIDEO_INTERPOLATE_OUTPUT', env.QUALITY_VIDEO_INTERPOLATE_OUTPUT, !legacy),
    numFrames: integer('QUALITY_VIDEO_NUM_FRAMES', env.QUALITY_VIDEO_NUM_FRAMES, legacy ? 81 : 121),
    framesPerSecond: integer('QUALITY_VIDEO_FPS', env.QUALITY_VIDEO_FPS, legacy ? 16 : 24),
    sampleShift: integer('QUALITY_VIDEO_SAMPLE_SHIFT', env.QUALITY_VIDEO_SAMPLE_SHIFT, 12),
    seedStrategy: String(env.QUALITY_VIDEO_SEED_STRATEGY || 'per-shot-deterministic'),
  };
  if (!['shared-deterministic','per-shot-deterministic','provider-random'].includes(profile.seedStrategy)) {
    throw new QualityProfileError('QUALITY_PROFILE_INVALID', 'QUALITY_VIDEO_SEED_STRATEGY is invalid');
  }
  buildWanInput({ prompt: 'capability validation', aspectRatio: '9:16', ...profile });
  return Object.freeze(profile);
}

module.exports = { LEGACY_FAST_MODEL, QualityProfileError, resolveQualityVideoProfile };
