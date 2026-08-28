'use strict';

const PRICING_STATUSES = Object.freeze(['VERIFIED','PROMOTIONAL','STALE','UNKNOWN']);

const PRICE_RECORDS = Object.freeze([
  ...['480p','720p','1080p'].map((resolution, index) => Object.freeze({
    provider: 'replicate', modelFamily: 'WAN_3', providerModelId: 'alibaba/wan-3', model: 'alibaba/wan-3',
    component: 'VIDEO', profile: 'STANDARD', variant: null, resolution, currency: 'USD', unit: 'SECOND',
    amountUsd: [0.05, 0.10, 0.20][index], formula: 'amountUsd * generated seconds', status: 'VERIFIED', verifiedAt: '2026-08-27',
    sourceType: 'OFFICIAL_PROVIDER_PAGE',
    source: 'https://replicate.com/alibaba/wan-3',
  })),
  ...['480p','720p','1080p'].map((resolution, index) => Object.freeze({
    provider: 'alibaba', modelFamily: 'WAN_3', providerModelId: 'wan3.0-video', model: 'wan3.0-video',
    component: 'VIDEO', profile: 'STANDARD', variant: 'PROMOTIONAL', resolution, currency: 'USD', unit: 'SECOND',
    amountUsd: [0.035, 0.07, 0.14][index], formula: 'amountUsd * generated seconds', status: 'PROMOTIONAL', verifiedAt: '2026-08-27',
    validUntil: '2026-09-23T16:00:00.000Z',
    sourceType: 'OFFICIAL_PROVIDER_DOCUMENTATION',
    source: 'https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-guide',
  })),
  Object.freeze({ provider: 'elevenlabs', modelFamily: 'ELEVEN_V3', providerModelId: 'eleven_v3', model: 'eleven_v3',
    component: 'VOICE', profile: 'STANDARD', variant: null, resolution: null, currency: 'USD', unit: 'CHARACTER',
    amountUsd: 0.0001, formula: 'amountUsd * input characters', status: 'VERIFIED', verifiedAt: '2026-08-27',
    validUntil: null, sourceType: 'OFFICIAL_PROVIDER_PRICING', source: 'https://elevenlabs.io/pricing/api' }),
]);

function currentStatus(record, now = new Date()) {
  if (!PRICING_STATUSES.includes(record?.status)) return 'UNKNOWN';
  if (record.status === 'PROMOTIONAL' && record.validUntil && now >= new Date(record.validUntil)) return 'STALE';
  return record.status;
}

function priceFor({ provider, model, component, resolution = null, now = new Date() } = {}) {
  const record = PRICE_RECORDS.find((item) => item.provider === provider && item.model === model
    && item.component === component && (!item.resolution || item.resolution === resolution));
  if (!record) return Object.freeze({ status: 'UNKNOWN', amountUsd: null, source: null });
  return Object.freeze({ ...record, status: currentStatus(record, now) });
}

function estimateComponent({ provider, model, component, resolution, durationSeconds, characterCount, count = 1, now } = {}) {
  const price = priceFor({ provider, model, component, resolution, now });
  const units = price.unit === 'SECOND' ? Number(durationSeconds || 0) * count
    : price.unit === 'CHARACTER' ? Number(characterCount || 0) * count : count;
  const amountUsd = price.amountUsd == null ? null : Number((price.amountUsd * units).toFixed(6));
  return Object.freeze({ component, provider, modelFamily: price.modelFamily || null,
    providerModelId: price.providerModelId || model, model, resolution: resolution || null, count, units,
    currency: price.currency || 'USD', profile: price.profile || null, variant: price.variant || null,
    unit: price.unit || null, unitPriceUsd: price.amountUsd, amountUsd, status: price.status,
    formula: price.formula || null, verifiedAt: price.verifiedAt || null, validUntil: price.validUntil || null,
    sourceType: price.sourceType || null, source: price.source || null });
}

function estimateMediaStack({ video, voice = null, semantic = null, master = null, now = new Date() } = {}) {
  const components = [];
  if (video) components.push(estimateComponent({ ...video, component: 'VIDEO', now }));
  if (voice) components.push(estimateComponent({ ...voice, component: 'VOICE', now }));
  else components.push(Object.freeze({ component: 'VOICE', provider: null, model: null, count: 0,
    amountUsd: 0, status: 'VERIFIED', currency: 'USD' }));
  if (semantic) components.push(Object.freeze({ component: 'SEMANTIC_CRITIC', provider: semantic.provider,
    model: semantic.model, count: semantic.count || 0, amountUsd: null, status: 'UNKNOWN', currency: 'USD' }));
  else components.push(Object.freeze({ component: 'SEMANTIC_CRITIC', provider: null, model: null,
    count: 0, amountUsd: 0, status: 'VERIFIED', currency: 'USD' }));
  components.push(Object.freeze({ component: 'OTHER_EXTERNAL', provider: master?.provider || null,
    model: master?.profile || null, count: 0, amountUsd: 0, status: 'VERIFIED', currency: 'USD' }));
  const known = components.every((item) => ['VERIFIED','PROMOTIONAL'].includes(item.status) && item.amountUsd != null);
  const knownSubtotalUsd = Number(components.reduce((sum, item) => sum + (item.amountUsd || 0), 0).toFixed(6));
  return Object.freeze({ currency: 'USD', components: Object.freeze(components),
    knownSubtotalUsd,
    estimatedTotalUsd: known ? Number(components.reduce((sum, item) => sum + item.amountUsd, 0).toFixed(6)) : null,
    status: known ? (components.some((item) => item.status === 'PROMOTIONAL') ? 'PROMOTIONAL' : 'VERIFIED') : 'UNKNOWN' });
}

module.exports = { PRICING_STATUSES, PRICE_RECORDS, currentStatus, priceFor, estimateComponent, estimateMediaStack };
