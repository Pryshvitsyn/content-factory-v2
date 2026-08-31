'use strict';

const crypto = require('node:crypto');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');

function revisionAssetId(sourceAssetId, requestId) {
  return `${sourceAssetId}-rev-${requestId.replaceAll('-', '').slice(0, 12)}`;
}

function buildShotRevision(raw, { shotId, requestId, instruction = null, revisionNo = 1, recoveryKind = null,
  retryReason = null } = {}) {
  const updated = structuredClone(raw);
  const shots = updated.scenes.flatMap((scene) => scene.shots);
  const shot = shots.find((item) => item.shot_id === shotId);
  if (!shot) throw Object.assign(new Error('Shot not found in canonical production plan'), { code: 'SHOT_NOT_FOUND' });
  const sourceAssetId = shot.asset_id;
  const replacementAssetId = revisionAssetId(sourceAssetId.replace(/-rev-[a-f0-9]{12}$/i, ''), requestId);
  shot.asset_id = replacementAssetId;
  shot.video.prompt = [shot.video.prompt, instruction && `Operator shot-regeneration instruction: ${instruction}`]
    .filter(Boolean).join('\n');
  shot.video.seed = Number.parseInt(crypto.createHash('sha256').update(`${requestId}:${shotId}`)
    .digest('hex').slice(0, 8), 16) % 2147483647;
  shot.continuity = `${shot.continuity || ''} Regeneration revision ${revisionNo}; preserve the established continuity identity.`.trim();
  const planned = updated.creative_plan?.shots?.find((item) => item.shotId === shotId);
  if (planned) {
    planned.assetId = replacementAssetId;
    planned.generationPrompt = shot.video.prompt;
    planned.seed = shot.video.seed;
    planned.revision = revisionNo;
    planned.supersedesAssetId = sourceAssetId;
    planned.retryReason = retryReason;
    planned.recoveryKind = recoveryKind;
  }
  const base = buildProductionInput(updated);
  const plannedShots = updated.creative_plan?.shots || [];
  const assets = base.assetPlan.assets.map((asset) => {
    if (asset.kind !== 'video') return asset;
    const plan = plannedShots.find((item) => item.assetId === asset.asset_id || item.shotId === base.shotPlan.shots
      .find((candidate) => candidate.required_assets?.includes(asset.asset_id))?.shot_id);
    if (!plan || plan.referencePolicy === 'NONE') return asset;
    const index = plannedShots.indexOf(plan);
    const reference = plan.referencePolicy === 'PREVIOUS_SHOT_FRAME'
      ? { policy: 'PREVIOUS_SHOT_FRAME', previousAssetId: plannedShots[index - 1]?.assetId || null }
      : { policy: 'UPLOADED_REFERENCE', artifact: plan.referenceMedia };
    const replacement = asset.asset_id === replacementAssetId;
    return Object.freeze({ ...asset, generation_requirements: Object.freeze({ ...asset.generation_requirements,
      v210_reference: Object.freeze(reference),
      ...(replacement ? { retry_reason: retryReason, recovery_kind: recoveryKind,
        supersedes_asset_id: sourceAssetId, revision_no: revisionNo } : {}) }) });
  });
  const normalized = { ...base, assetPlan: Object.freeze({ ...base.assetPlan, assets: Object.freeze(assets) }),
    productionNamespace: 'v2.7-operator', geometryRecovery: recoveryKind === 'SOURCE_GEOMETRY'
      ? Object.freeze({ sourceAssetId, replacementAssetId, retryReason, revisionNo, automaticAttempt: 1 }) : null,
    sourceRecovery: recoveryKind === 'SOURCE_CREATIVE'
      ? Object.freeze({ recoveryKind, sourceAssetId, replacementAssetId, retryReason, revisionNo,
        automaticAttempt: 1 }) : null };
  delete normalized.fingerprint;
  const input = Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
  return Object.freeze({ raw: updated, input, sourceAssetId, replacementAssetId, revisionNo });
}

module.exports = { buildShotRevision, revisionAssetId };
