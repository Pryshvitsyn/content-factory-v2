'use strict';

const { fromAsset } = require('../src/v2.8/canonical-media-request');

const CAPABILITIES = Object.freeze({
  image: 'image-generation',
  video: 'video-generation',
  voice: 'speech-generation',
  audio: 'audio-generation',
});

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function normalizeTemporal({ asset, response } = {}) {
  const temporal = response.temporal || asset.temporal || asset.generation_requirements?.temporal || null;
  if (!temporal) return null;

  const startMs = temporal.startMs ?? null;
  const endMs = temporal.endMs ?? null;
  const durationMs = temporal.durationMs ?? null;
  const offsetMs = temporal.offsetMs ?? 0;

  for (const [name, value] of Object.entries({ startMs, endMs, durationMs, offsetMs })) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid temporal ${name} for asset ${asset.asset_id}`);
    }
  }
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new Error(`Invalid temporal boundaries for asset ${asset.asset_id}`);
  }
  if (durationMs !== null && startMs !== null && endMs !== null && endMs - startMs !== durationMs) {
    throw new Error(`Temporal duration mismatch for asset ${asset.asset_id}`);
  }

  return Object.freeze({ startMs, endMs, durationMs, offsetMs });
}

function normalizeMediaResult({ asset, response } = {}) {
  requireValue('asset', asset);
  requireValue('response', response);

  const output = response.output;
  const contentType = response.contentType || response.mimeType || null;
  const mediaUrl = response.mediaUrl || response.url || null;
  const bytes = Buffer.isBuffer(output) ? output : null;

  if (!bytes && !mediaUrl) throw new Error(`Media provider returned neither bytes nor URL for asset ${asset.asset_id}`);
  if (!contentType && (bytes || mediaUrl)) throw new Error(`Media provider must return contentType for media asset ${asset.asset_id}`);

  const temporal = normalizeTemporal({ asset, response });

  return Object.freeze({
    assetId: asset.asset_id,
    kind: asset.kind,
    contentType,
    bytes,
    mediaUrl,
    temporal,
    // Renderer/assembly will use temporal boundaries and later join audio/video
    // on a deterministic timeline; this boundary deliberately does not mux media.
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

async function generateMediaAsset({ providerGateway, asset, productionId, brandId = null, workerId, onProviderRequest = null } = {}) {
  requireValue('providerGateway', providerGateway);
  requireValue('asset', asset);
  requireValue('productionId', productionId);
  requireValue('workerId', workerId);

  const capability = capabilityForAssetKind(asset.kind);
  const requirements = asset.generation_requirements || {};
  // Certified V2.1 assets may intentionally rely on registry routing and have no
  // persisted provider/model. V2.8 inputs are explicit and receive the canonical
  // contract; legacy inputs keep their original request shape unchanged.
  const canonicalRequest = requirements.provider && requirements.model ? fromAsset(asset) : null;
  const response = await providerGateway.generate({
    capability,
    routeKey: `media:${asset.kind}`,
    provider: requirements.provider,
    model: requirements.model,
    idempotencyKey: `${brandId ? `${brandId}:` : ''}${productionId}:media:${asset.asset_id}`,
    ...(onProviderRequest ? { onProviderRequest } : {}),
    ...(canonicalRequest ? { canonicalRequest } : {}),
    prompt: JSON.stringify({
      asset_id: asset.asset_id,
      kind: asset.kind,
      description: asset.description,
      source_preference: asset.source_preference,
      generation_requirements: asset.generation_requirements,
      required_for_shots: asset.required_for_shots,
      temporal: asset.temporal || asset.generation_requirements?.temporal || null,
    }),
    metadata: { productionId, brandId, workerId, assetId: asset.asset_id, assetKind: asset.kind },
  });

  return normalizeMediaResult({ asset, response });
}

module.exports = { CAPABILITIES, capabilityForAssetKind, normalizeTemporal, normalizeMediaResult, generateMediaAsset };
