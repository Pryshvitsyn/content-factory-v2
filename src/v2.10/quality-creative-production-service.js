'use strict';

const { CreativeProductionService } = require('./creative-production-service');
const { scriptSourceFingerprint, storyboardSourceFingerprint } = require('./creative-contract');

class QualityCreativeProductionService extends CreativeProductionService {
  async updateDraft(args) {
    let before = null;
    if (args?.id && args?.brandId) {
      try { before = await this.getDraft({ id: args.id, brandId: args.brandId }); } catch { before = null; }
    }
    const updated = await super.updateDraft(args);
    if (before && typeof this.repository.invalidateQualityStages === 'function') {
      const scope = await this.scope(args.brandId);
      const oldScript = scriptSourceFingerprint(before.creative_brief);
      const newScript = scriptSourceFingerprint(updated.creative_brief);
      const oldStoryboard = storyboardSourceFingerprint(before.creative_brief);
      const newStoryboard = storyboardSourceFingerprint(updated.creative_brief);
      if (oldScript !== newScript) {
        await this.repository.invalidateQualityStages({ draftId: args.id, ...scope, fromStage: 'SCRIPT',
          reason: 'CANONICAL_SCRIPT_INPUT_CHANGED', actor: this.actor });
      } else if (oldStoryboard !== newStoryboard) {
        await this.repository.invalidateQualityStages({ draftId: args.id, ...scope, fromStage: 'STORYBOARD',
          reason: 'CANONICAL_STORYBOARD_INPUT_CHANGED', actor: this.actor });
      }
    }
    return updated;
  }

  async preflight(args) {
    if (typeof this.repository.assertQualityDirectorGate === 'function') {
      const scope = await this.scope(args.brandId);
      await this.repository.assertQualityDirectorGate({ draftId: args.id, ...scope,
        requiredStages: ['SCRIPT', 'STORYBOARD'] });
    }
    return super.preflight(args);
  }

  async start(args) {
    if (typeof this.repository.assertQualityDirectorGate === 'function') {
      const scope = await this.scope(args.brandId);
      await this.repository.assertQualityDirectorGate({ draftId: args.id, ...scope,
        requiredStages: ['SCRIPT', 'STORYBOARD', 'LOOK', 'PILOT'] });
    }
    return super.start(args);
  }
}

module.exports = { QualityCreativeProductionService };
