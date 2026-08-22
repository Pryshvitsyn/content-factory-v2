'use strict';

class AssetBindingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AssetBindingError';
    this.details = details;
  }
}

function assertFiniteNonNegative(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new AssetBindingError(`Invalid temporal value: ${field}`, { field, value });
  }
}

function normalizeTemporal(asset) {
  if (!asset.temporal) return null;
  const { startMs, endMs, durationMs } = asset.temporal;
  assertFiniteNonNegative(startMs, 'startMs');
  assertFiniteNonNegative(endMs, 'endMs');
  assertFiniteNonNegative(durationMs, 'durationMs');
  if (endMs < startMs || durationMs !== endMs - startMs) {
    throw new AssetBindingError('Asset temporal metadata is inconsistent', { temporal: asset.temporal });
  }
  return Object.freeze({ startMs, endMs, durationMs });
}

function bindAssetToShot(asset, shot) {
  if (!asset || typeof asset !== 'object' || !asset.assetId || !asset.versionId) {
    throw new AssetBindingError('Asset must have immutable assetId and versionId');
  }
  if (!shot || typeof shot !== 'object' || !shot.shotId) {
    throw new AssetBindingError('Shot must have shotId');
  }

  const temporal = normalizeTemporal(asset);
  const shotStartMs = shot.startMs ?? 0;
  const shotEndMs = shot.endMs;
  assertFiniteNonNegative(shotStartMs, 'shot.startMs');
  if (!Number.isFinite(shotEndMs) || shotEndMs < shotStartMs) {
    throw new AssetBindingError('Shot temporal window is invalid', { shotId: shot.shotId });
  }

  if (temporal && (temporal.startMs > shotStartMs || temporal.endMs < shotEndMs)) {
    throw new AssetBindingError('Asset does not cover the complete shot window', {
      assetId: asset.assetId,
      versionId: asset.versionId,
      shotId: shot.shotId,
      assetTemporal: temporal,
      shotWindow: { startMs: shotStartMs, endMs: shotEndMs },
    });
  }

  const requiredCapability = shot.requiredCapability || shot.capability || null;
  if (requiredCapability && asset.capability !== requiredCapability) {
    throw new AssetBindingError('Asset capability is incompatible with shot', {
      assetCapability: asset.capability,
      requiredCapability,
      shotId: shot.shotId,
    });
  }

  const binding = {
    shotId: shot.shotId,
    assetId: asset.assetId,
    assetVersionId: asset.versionId,
    capability: asset.capability || null,
    provider: asset.provider || null,
    model: asset.model || null,
    contentType: asset.contentType || null,
    temporal,
    role: shot.role || null,
  };

  return Object.freeze(binding);
}

function bindAssetsToTimeline(assets, shots) {
  if (!Array.isArray(assets) || !Array.isArray(shots)) {
    throw new AssetBindingError('assets and shots must be arrays');
  }
  const byShot = new Map();
  for (const shot of shots) byShot.set(shot.shotId, []);
  for (const asset of assets) {
    if (!asset.shotId) throw new AssetBindingError('Asset binding requires shotId');
    const shot = shots.find((candidate) => candidate.shotId === asset.shotId);
    if (!shot) throw new AssetBindingError('Asset references unknown shot', { shotId: asset.shotId });
    const binding = bindAssetToShot(asset, shot);
    byShot.get(shot.shotId).push(binding);
  }
  for (const shot of shots) {
    if (shot.requiredCapability && byShot.get(shot.shotId).length === 0) {
      throw new AssetBindingError('Required shot has no compatible asset', { shotId: shot.shotId });
    }
  }
  return Object.freeze(shots.map((shot) => Object.freeze({
    shotId: shot.shotId,
    bindings: Object.freeze(byShot.get(shot.shotId)),
  })));
}

module.exports = { AssetBindingError, bindAssetToShot, bindAssetsToTimeline };
