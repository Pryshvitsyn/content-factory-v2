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
  async listDrafts({ brandId, limit = 20 } = {}) {
    if (!brandId) throw new core.CreativeProductionError(400, 'BRAND_REQUIRED', 'Brand is required');
    const scope = await this.scope(brandId);
    const capped = Math.min(50, Math.max(1, Number(limit) || 20));
    if (typeof this.repository.listDrafts === 'function') {
      return this.repository.listDrafts({ ...scope, limit: capped });
    }
    if (!this.repository?.db?.query) {
      throw new core.CreativeProductionError(409, 'DRAFT_BROWSER_UNAVAILABLE', 'Creative draft read model is unavailable');
    }
    const result = await this.repository.db.query(`/* v2.10:operator-list-drafts */
      SELECT * FROM v2_10.creative_drafts
      WHERE workspace_id=$1 AND brand_id=$2
      ORDER BY updated_at DESC, created_at DESC LIMIT $3`, [scope.workspaceId, scope.brandId, capped]);
    return result.rows;
  }

  async getDraft({ id, brandId } = {}) {
    if (!id) throw new core.CreativeProductionError(400, 'DRAFT_ID_REQUIRED', 'Draft ID is required');
    if (!brandId) throw new core.CreativeProductionError(400, 'BRAND_REQUIRED', 'Brand is required');
    const scope = await this.scope(brandId);
    const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new core.CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    return draft;
  }

  async preflight({ video = {}, ...args }) {
    return super.preflight({ ...args, video: normalizeV210Video(video) });
  }
}

module.exports = { ...core, CreativeProductionService, normalizeV210Video };
