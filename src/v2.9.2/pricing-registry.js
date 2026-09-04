'use strict';

const PRICING_STATUSES = Object.freeze(['VERIFIED','PROMOTIONAL','STALE','UNKNOWN']);

const PRICE_RECORDS = Object.freeze([
  Object.freeze({ provider: 'openai', modelFamily: 'OPENAI_IMAGE', providerModelId: 'gpt-image-2', model: 'gpt-image-2',
    component: 'IMAGE_TEXT_INPUT', profile: null, variant: null, resolution: null, currency: 'USD', unit: 'MILLION_TOKENS',
    amountUsd: 5, formula: 'text_input_tokens * 5 / 1000000', status: 'VERIFIED', verifiedAt: '2026-09-01',
    sourceType: 'OFFICIAL_PROVIDER_DOCUMENTATION', source: 'https://developers.openai.com/api/docs/guides/image-generation' }),
  Object.freeze({ provider: 'openai', modelFamily: 'OPENAI_IMAGE', providerModelId: 'gpt-image-2', model: 'gpt-image-2',
    component: 'IMAGE_REFERENCE_INPUT', profile: null, variant: null, resolution: null, currency: 'USD', unit: 'MILLION_TOKENS',
    amountUsd: 8, formula: 'image_input_tokens * 8 / 1000000', status: 'VERIFIED', verifiedAt: '2026-09-01',
    sourceType: 'OFFICIAL_PROVIDER_DOCUMENTATION', source: 'https://developers.openai.com/api/docs/guides/image-generation' }),
  Object.freeze({ provider: 'openai', modelFamily: 'OPENAI_IMAGE', providerModelId: 'gpt-image-2', model: 'gpt-image-2',
    component: 'IMAGE_OUTPUT', profile: null, variant: null, resolution: null, currency: 'USD', unit: 'MILLION_TOKENS',
    amountUsd: 30, formula: 'image_output_tokens * 30 / 1000000', status: 'VERIFIED', verifiedAt: '2026-09-01',
    sourceType: 'OFFICIAL_PROVIDER_DOCUMENTATION', source: 'https://developers.openai.com/api/docs/guides/image-generation' }),
  ...['480p','720p','1080p'].map((resolution, index) => Object.freeze({
    provider: 'replicate', modelFamily: 'WAN_3', providerModelId: 'alibaba/wan-3', model: 'alibaba/wan-3',
    component: 'VIDEO', profile: 'STANDARD', variant: null, resolution, currency: 'USD', unit: 'SECOND',
    amountUsd: [0.05, 0.10, 0.20][index], formula: 'amountUsd * generated seconds', status: 'VERIFIED', verifiedAt: '2026-08-27',
    sourceType: 'OFFICIAL_PROVIDER_PAGE',
    source: 'https://replicate.com/alibaba/wan-3',
  })),
  Object.freeze({ provider: 'replicate', modelFamily: 'WAN_2_7_R2V', providerModelId: 'wan-video/wan-2.7-r2v', model: 'wan-video/wan-2.7-r2v',
    component: 'VIDEO', profile: 'STANDARD', variant: null, resolution: '720p', currency: 'USD', unit: 'SECOND', amountUsd: 0.10,
    formula: 'amountUsd * generated seconds', status: 'VERIFIED', verifiedAt: '2026-09-04', sourceType: 'OFFICIAL_PROVIDER_PAGE', source: 'https://replicate.com/wan-video/wan-2.7-r2v' }),
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

const GPT_IMAGE_2_OUTPUT_ESTIMATES = Object.freeze({
  low: Object.freeze({ '1024x1024': 0.006, '1024x1536': 0.005, '1536x1024': 0.005 }),
  medium: Object.freeze({ '1024x1024': 0.053, '1024x1536': 0.041, '1536x1024': 0.041 }),
  high: Object.freeze({ '1024x1024': 0.211, '1024x1536': 0.165, '1536x1024': 0.165 }),
});

function imageTokenRates(model = 'gpt-image-2') {
  const find = (component) => PRICE_RECORDS.find((item) => item.provider === 'openai' && item.model === model && item.component === component);
  const text = find('IMAGE_TEXT_INPUT'), image = find('IMAGE_REFERENCE_INPUT'), output = find('IMAGE_OUTPUT');
  if (!text || !image || !output) return null;
  return Object.freeze({ version: 'openai-image-api-2026-09-01', currency: 'USD', perMillionTokens: Object.freeze({
    textInput: text.amountUsd, imageInput: image.amountUsd, imageOutput: output.amountUsd }), verifiedAt: text.verifiedAt,
    source: text.source });
}

function estimateOpenAIImagePlan({ model, size, quality, count = 1, referenceImageCount = 1 } = {}) {
  const total = Number(count); const references = Number(referenceImageCount);
  if (model !== 'gpt-image-2' || !Number.isInteger(total) || total < 1) return Object.freeze({ status: 'UNKNOWN',
    knownTotalCost: null, knownSubtotalCost: 0, estimatedOutputCost: null, maximumEstimatedCost: null,
    unknownElements: Object.freeze(['PROVIDER_TOKEN_RATES','TEXT_INPUT_TOKENS','IMAGE_INPUT_TOKENS','OUTPUT_TOKENS','TOTAL_COST']),
    currency: 'USD', inventedCosts: false, unknownIsZero: false });
  const normalizedQuality = String(quality || 'high').toLowerCase();
  const outputPerCall = GPT_IMAGE_2_OUTPUT_ESTIMATES[normalizedQuality]?.[size] ?? null;
  const outputSubtotal = outputPerCall == null ? 0 : Number((outputPerCall * total).toFixed(6));
  return Object.freeze({ status: outputPerCall == null ? 'UNKNOWN' : 'PARTIAL', knownTotalCost: null,
    knownSubtotalCost: 0, estimatedOutputCost: outputPerCall == null ? null : outputSubtotal,
    estimatedOutputCostPerCall: outputPerCall, maximumEstimatedCost: null, tokenRates: imageTokenRates(model),
    referenceImageCount: references, requestCount: total,
    unknownElements: Object.freeze(['TEXT_INPUT_TOKENS','IMAGE_INPUT_TOKENS','TOTAL_COST']), currency: 'USD',
    pricingVersion: 'openai-image-api-2026-09-01', outputEstimateSource: 'OFFICIAL_GPT_IMAGE_2_CALCULATOR_TABLE',
    inventedCosts: false, unknownIsZero: false });
}

function actualOpenAIImageCost({ model, usage } = {}) {
  const rates = imageTokenRates(model); const input = usage?.input_tokens_details || {};
  const textTokens = Number(input.text_tokens), imageTokens = Number(input.image_tokens), outputTokens = Number(usage?.output_tokens);
  if (!rates || ![textTokens,imageTokens,outputTokens].every(Number.isFinite)) return null;
  return Number(((textTokens * rates.perMillionTokens.textInput + imageTokens * rates.perMillionTokens.imageInput
    + outputTokens * rates.perMillionTokens.imageOutput) / 1_000_000).toFixed(6));
}

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

module.exports = { PRICING_STATUSES, PRICE_RECORDS, GPT_IMAGE_2_OUTPUT_ESTIMATES, currentStatus, priceFor,
  imageTokenRates, estimateOpenAIImagePlan, actualOpenAIImageCost, estimateComponent, estimateMediaStack };
