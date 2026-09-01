'use strict';

class ProviderError extends Error {
  constructor(message, { provider, model, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = model;
    this.cause = cause;
  }
}

const MEDIA_CAPABILITIES = new Set([
  'image-generation',
  'image-editing',
  'multi-view-identity-reference',
  'video-generation',
  'speech-generation',
  'audio-generation',
]);

function isBinary(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function assertProviderResult(result) {
  if (!result || typeof result !== 'object') {
    throw new ProviderError('Provider returned no result');
  }
  if (!result.provider || !result.model) {
    throw new ProviderError('Provider result violates normalized contract', {
      provider: result.provider,
      model: result.model,
    });
  }

  const hasTextOutput = typeof result.output === 'string';
  const hasBinaryOutput = isBinary(result.output);
  const hasMediaUrl = typeof result.mediaUrl === 'string' && result.mediaUrl.length > 0;
  const hasMediaMetadata = typeof result.contentType === 'string' && result.contentType.length > 0;
  const isMediaResult = MEDIA_CAPABILITIES.has(result.capability);

  if (!hasTextOutput && !hasBinaryOutput && !(isMediaResult && hasMediaUrl)) {
    throw new ProviderError('Provider result violates normalized contract', {
      provider: result.provider,
      model: result.model,
    });
  }

  if (isMediaResult && !hasMediaMetadata) {
    throw new ProviderError('Media provider result must include contentType', {
      provider: result.provider,
      model: result.model,
    });
  }

  return Object.freeze({
    provider: result.provider,
    model: result.model,
    capability: result.capability || null,
    output: result.output || null,
    mediaUrl: result.mediaUrl || null,
    contentType: result.contentType || null,
    temporal: result.temporal ? Object.freeze({ ...result.temporal }) : null,
    provenance: result.provenance ? Object.freeze({ ...result.provenance }) : null,
    requestId: result.requestId || null,
    usage: result.usage || null,
    actualKnownCost: Number.isFinite(result.actualKnownCost) ? Number(result.actualKnownCost) : null,
    raw: result.raw || null,
  });
}

module.exports = { ProviderError, MEDIA_CAPABILITIES, assertProviderResult };
