'use strict';

const core = require('./creative-production-service-core');

function normalizeV210Video(video = {}) {
  const requestedProfile = String(video.profile || '').trim().toUpperCase();
  const profile = requestedProfile === 'QUALITY' ? 'STANDARD' : requestedProfile;
  const requestedResolution = String(video.resolution || '').trim();
  const legacyCanvasResolution = /^(?:480x854|720x1280|1080x1920)$/i.test(requestedResolution);
  return Object.freeze({
    ...video,
    profile,
    resolution: legacyCanvasResolution ? null : (video.resolution || null),
  });
}

class CreativeProductionService extends core.CreativeProductionService {
  async preflight({ video = {}, ...args }) {
    return super.preflight({ ...args, video: normalizeV210Video(video) });
  }
}

module.exports = { ...core, CreativeProductionService, normalizeV210Video };
