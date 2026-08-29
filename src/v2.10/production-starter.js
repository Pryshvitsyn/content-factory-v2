'use strict';

const { canonicalCreativeBrief, buildShotPrompt } = require('./creative-contract');

function buildExecutionPlan({ draft, preflight }) {
  const brief = canonicalCreativeBrief(draft.creative_brief || draft.creativeBrief);
  return Object.freeze({
    schemaVersion: '2.10', draftId: draft.id, draftRevision: draft.revision,
    workspaceId: draft.workspace_id || draft.workspaceId, brandId: draft.brand_id || draft.brandId,
    preflightFingerprint: preflight.fingerprint,
    video: Object.freeze({ ...preflight.video, shots: Object.freeze(brief.storyboard.map((shot, index) => Object.freeze({
      index, shotId: shot.shotId, assetId: shot.assetId, durationSeconds: shot.durationSeconds,
      roles: shot.roles, prompt: buildShotPrompt(brief, shot), negativeGuidance: shot.negativeGuidance,
      referencePolicy: shot.referencePolicy, referenceMedia: shot.referenceMedia,
    }))) }),
    voice: Object.freeze({ ...brief.voice, externalCalls: preflight.externalCalls.speech,
      generationRequired: brief.voice.sourceType !== 'UPLOADED_AUDIO', uploadedArtifactId: brief.voice.uploadedArtifactId }),
    postProduction: brief.postProduction, master: preflight.master,
    publicationPolicy: Object.freeze({ humanApprovalRequired: true, autoPublish: false }),
    externalCalls: preflight.externalCalls,
  });
}

class V210ProductionStarter {
  constructor({ executor }) { if (!executor || typeof executor.start !== 'function') throw new Error('V2.10 executor is required'); this.executor = executor; }
  async start({ draft, preflight, actor }) {
    const plan = buildExecutionPlan({ draft, preflight });
    return this.executor.start({ plan, actor, idempotencyKey: `v2.10:${draft.id}:${preflight.fingerprint}` });
  }
}

module.exports = { buildExecutionPlan, V210ProductionStarter };
