'use strict';

const crypto = require('node:crypto');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');

const SOURCE_RECOVERY_EXECUTION_PROJECTION_VERSION = 'v2.10.4.1';
const SOURCE_RECOVERY_KINDS = new Set(['SOURCE_CREATIVE', 'SOURCE_GEOMETRY']);

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

function buildSourceRecoveryExecutionInput(canonicalRevision, { sourceAssetId, replacementAssetId,
  recoveryKind, retryReason = null, revisionNo = 1 } = {}) {
  if (!SOURCE_RECOVERY_KINDS.has(recoveryKind)) {
    throw Object.assign(new Error('Source recovery execution requires a bounded recovery kind'), {
      code: 'SOURCE_RECOVERY_PLAN_INVALID',
    });
  }
  const source = structuredClone(canonicalRevision);
  const replacement = source.assetPlan?.assets?.find((asset) => asset.asset_id === replacementAssetId
    && asset.kind === 'video');
  const shot = source.shotPlan?.shots?.find((candidate) => candidate.required_assets?.includes(replacementAssetId));
  const scene = source.script?.scenes?.find((candidate) => String(candidate.scene_number) === String(shot?.scene_id));
  if (!replacement || !shot || !scene) {
    throw Object.assign(new Error('Bounded source recovery projection cannot resolve its replacement shot'), {
      code: 'SOURCE_RECOVERY_PLAN_INVALID',
    });
  }

  const durationSeconds = Number(shot.duration_seconds);
  const projectedAsset = { ...replacement, required_for_shots: Object.freeze([shot.shot_id]) };
  const projectedShot = { ...shot, required_assets: Object.freeze([replacementAssetId]) };
  const projectedScene = { ...scene, duration_seconds: durationSeconds,
    dialogue_or_voiceover: source.script.approved_spoken_copy };
  const recovery = Object.freeze({ projectionVersion: SOURCE_RECOVERY_EXECUTION_PROJECTION_VERSION,
    canonicalRevisionFingerprint: canonicalRevision.fingerprint, recoveryKind, sourceAssetId,
    replacementAssetId, retryReason, revisionNo });
  const normalized = { ...source,
    targetDurationSeconds: durationSeconds,
    voiceover: Object.freeze({ ...(source.voiceover || {}), enabled: false }),
    captions: Object.freeze({ ...(source.captions || {}), enabled: false, end_title: null }),
    postProduction: source.postProduction ? Object.freeze({ ...source.postProduction,
      endTitle: source.postProduction.endTitle
        ? Object.freeze({ ...source.postProduction.endTitle, enabled: false }) : source.postProduction.endTitle }) : null,
    script: Object.freeze({ ...source.script, scenes: Object.freeze([Object.freeze(projectedScene)]) }),
    shotPlan: Object.freeze({ ...source.shotPlan, shots: Object.freeze([Object.freeze(projectedShot)]) }),
    assetPlan: Object.freeze({ ...source.assetPlan, assets: Object.freeze([Object.freeze(projectedAsset)]) }),
    profile: Object.freeze({ ...projectedAsset.generation_requirements }),
    sourceRecoveryExecution: recovery };
  delete normalized.fingerprint;
  return Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
}

module.exports = { buildShotRevision, buildSourceRecoveryExecutionInput, revisionAssetId,
  SOURCE_RECOVERY_EXECUTION_PROJECTION_VERSION };
