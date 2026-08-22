'use strict';

const CAPABILITIES = Object.freeze({
  image: 'image-generation',
  video: 'video-generation',
  voice: 'speech-generation',
  audio: 'audio-generation',
});

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function normalizeMediaResult({ asset, response } = {}) {
  requireValue('asset', asset);
  requireValue('response', response);

  const output = response.output;
  const contentType = response.contentType || response.mimeType || null;
  const mediaUrl = response.mediaUrl || response.url || null;
  const bytes = Buffer.isBuffer(output) ? output : null;

  if (!bytes && !mediaUrl) throw new Error(`Media provider returned neither bytes nor URL for asset ${asset.asset_id}`);
  if (!contentType && bytes) throw new Error(`Media provider must return contentType for binary asset ${asset.asset_id}`);

  return Object.freeze({
    assetId: asset.asset_id,
    kind: asset.kind,
    contentType,
    bytes,
    mediaUrl,
    provider: response.provenance?.provider || response.provider || null,
    model: response.provenance?.model || response.model || null,
    requestId: response.requestId || response.provenance?.requestId || null,
    usage: response.usage || null,
    provenance: Object.freeze({ ...(response.provenance || {}) }),
  });
}

function capabilityForAssetKind(kind) {
  const capability = CAPABILITIES[kind];
  if (!capability) throw new Error(`Unsupported media asset kind: ${kind}`);
  return capability;
}

async function generateMediaAsset({ providerGateway, asset, productionId, workerId } = {}) {
  requireValue('providerGateway', providerGateway);
  requireValue('asset', asset);
  requireValue('productionId', productionId);
  requireValue('workerId', workerId);

  const capability = capabilityForAssetKind(asset.kind);
  const response = await providerGateway.generate({
    capability,
    routeKey: `media:${asset.kind}`,
    idempotencyKey: `${productionId}:media:${asset.asset_id}`,
    prompt: JSON.stringify({
      asset_id: asset.asset_id,
      kind: asset.kind,
      description: asset.description,
      source_preference: asset.source_preference,
      generation_requirements: asset.generation_requirements,
      required_for_shots: asset.required_for_shots,
    }),
    metadata: { productionId, workerId, assetId: asset.asset_id, assetKind: asset.kind },
  });

  return normalizeMediaResult({ asset, response });
}

module.exports = { CAPABILITIES, capabilityForAssetKind, normalizeMediaResult, generateMediaAsset };
