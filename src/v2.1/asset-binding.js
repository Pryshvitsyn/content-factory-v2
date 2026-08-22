'use strict';

class AssetBindingError extends Error { constructor(message, details = {}) { super(message); this.name = 'AssetBindingError'; this.details = details; } }
function assertTime(value, field) { if (!Number.isFinite(value) || value < 0) throw new AssetBindingError(`Invalid temporal value: ${field}`, { field, value }); }
function bindAssetToShot(asset, shot) {
  if (!asset?.assetId || !asset?.versionId) throw new AssetBindingError('Asset must have immutable assetId and versionId');
  if (!shot?.shotId) throw new AssetBindingError('Shot must have shotId');
  const temporal = asset.temporal ? { ...asset.temporal } : null;
  if (temporal) { for (const field of ['startMs', 'endMs', 'durationMs']) assertTime(temporal[field], `asset.temporal.${field}`); if (temporal.endMs < temporal.startMs || temporal.durationMs !== temporal.endMs - temporal.startMs) throw new AssetBindingError('Asset temporal metadata is inconsistent', { temporal }); }
  const startMs = shot.startMs ?? 0; const endMs = shot.endMs; assertTime(startMs, 'shot.startMs'); assertTime(endMs, 'shot.endMs');
  if (endMs < startMs) throw new AssetBindingError('Shot temporal window is invalid', { shotId: shot.shotId });
  if (temporal && (temporal.startMs > startMs || temporal.endMs < endMs)) throw new AssetBindingError('Asset does not cover the complete shot window', { assetId: asset.assetId, versionId: asset.versionId, shotId: shot.shotId });
  const requiredCapability = shot.requiredCapability || shot.capability || null;
  if (requiredCapability && asset.capability !== requiredCapability) throw new AssetBindingError('Asset capability is incompatible with shot', { assetCapability: asset.capability, requiredCapability, shotId: shot.shotId });
  return Object.freeze({ shotId: shot.shotId, assetId: asset.assetId, assetVersionId: asset.versionId, capability: asset.capability || null, provider: asset.provider || null, model: asset.model || null, contentType: asset.contentType || null, temporal: temporal ? Object.freeze(temporal) : null, role: shot.role || null });
}
function bindAssetsToTimeline(assets, shots) {
  if (!Array.isArray(assets) || !Array.isArray(shots)) throw new AssetBindingError('assets and shots must be arrays');
  const byShot = new Map(shots.map((shot) => [shot.shotId, []]));
  for (const asset of assets) { if (!asset.shotId || !byShot.has(asset.shotId)) throw new AssetBindingError('Asset references unknown shot', { shotId: asset.shotId }); byShot.get(asset.shotId).push(bindAssetToShot(asset, shots.find((shot) => shot.shotId === asset.shotId))); }
  for (const shot of shots) if (shot.requiredCapability && byShot.get(shot.shotId).length === 0) throw new AssetBindingError('Required shot has no compatible asset', { shotId: shot.shotId });
  return Object.freeze(shots.map((shot) => Object.freeze({ shotId: shot.shotId, bindings: Object.freeze(byShot.get(shot.shotId)) })));
}
module.exports = { AssetBindingError, bindAssetToShot, bindAssetsToTimeline };
