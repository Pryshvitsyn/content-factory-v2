'use strict';

const crypto = require('crypto');

const RESOLVER_VERSION = 1;

const LAYER_ORDER = Object.freeze([
  'tenant',
  'business',
  'brand',
  'audience',
  'offering',
  'strategy',
  'universe',
  'series',
  'production',
]);

const REQUIRED_LAYERS = Object.freeze(['tenant', 'business', 'brand']);

const PROVIDER_KEYS = new Set([
  'provider',
  'providerConfig',
  'model',
  'modelConfig',
  'apiKey',
  'api_key',
  'endpoint',
  'endpointUrl',
  'credentials',
]);

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function fingerprint(value) {
  return `ctx_${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 24)}`;
}

function assertNoProviderConfig(value, path = 'context') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, i) => assertNoProviderConfig(child, `${path}[${i}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (PROVIDER_KEYS.has(key)) {
      throw new Error(`${path}.${key} must not contain provider configuration`);
    }
    assertNoProviderConfig(child, `${path}.${key}`);
  }
}

function merge(base, override) {
  if (override === undefined) return clone(base);
  if (!base || typeof base !== 'object' || Array.isArray(base)) return clone(override);
  if (!override || typeof override !== 'object' || Array.isArray(override)) return clone(override);

  const out = clone(base);
  for (const [key, value] of Object.entries(override)) out[key] = merge(out[key], value);
  return out;
}

function layerPayload(layer, value) {
  switch (layer) {
    case 'tenant':
      return {
        metadata: value.metadata || {},
        rules: value.rules || {},
      };
    case 'business':
      return {
        industry: value.industry || null,
        rules: value.rules || {},
      };
    case 'brand':
      return {
        voice: value.voice || {},
        visualIdentity: value.visualIdentity || {},
        rules: value.rules || {},
        complianceRules: value.complianceRules || {},
      };
    case 'audience':
      return { profile: value.profile || {} };
    case 'offering':
      return {
        type: value.offeringType || value.offering_type || null,
        description: value.description || null,
        claims: value.claims || [],
        metadata: value.metadata || {},
      };
    case 'strategy':
      return {
        objective: value.objective || {},
        pillars: value.pillars || [],
        platformRules: value.platformRules || value.platform_rules || {},
        trendRules: value.trendRules || value.trend_rules || {},
        learningPolicy: value.learningPolicy || value.learning_policy || {},
      };
    case 'universe':
      return {
        premise: value.premise || null,
        rules: value.rules || {},
      };
    case 'series':
      return {
        formatRules: value.formatRules || value.format_rules || {},
        narrativeRules: value.narrativeRules || value.narrative_rules || {},
      };
    case 'production':
      return { rules: value.rules || {} };
    default:
      return {};
  }
}

function reference(layer, value) {
  assertObject(value, `context.${layer}`);
  if (!value.id) throw new Error(`context.${layer}.id is required`);
  const version = value.version === undefined ? 1 : value.version;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`context.${layer}.version must be a positive integer`);
  }
  return {
    id: value.id,
    version,
    name: value.name || null,
  };
}

function resolveContext(input) {
  assertObject(input, 'context');

  for (const layer of REQUIRED_LAYERS) {
    if (!input[layer]) throw new Error(`context.${layer} is required`);
  }

  const references = {};
  const sources = [];
  let effective = {};

  for (const layer of LAYER_ORDER) {
    const value = input[layer];
    if (!value) continue;

    const ref = reference(layer, value);
    references[layer] = ref;

    const payload = layerPayload(layer, value);
    assertNoProviderConfig(payload, `context.${layer}`);

    effective = merge(effective, payload);
    sources.push({
      layer,
      id: ref.id,
      version: ref.version,
    });
  }

  assertNoProviderConfig(effective, 'resolvedContext.effective');

  const resolved = {
    resolverVersion: RESOLVER_VERSION,
    references,
    effective,
    sources,
  };

  return Object.freeze({
    ...resolved,
    fingerprint: fingerprint(resolved),
  });
}

module.exports = {
  RESOLVER_VERSION,
  LAYER_ORDER,
  REQUIRED_LAYERS,
  canonicalize,
  canonicalJson,
  fingerprint,
  resolveContext,
};
