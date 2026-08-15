'use strict';

const crypto = require('crypto');
const { BIBLE_CONTRACT_VERSION, PLATFORMS } = require('./v2.1-bible-contract');
const { validateBible } = require('./v2.1-bible-validator');

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

function fingerprint(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 24)}`;
}

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
}

function merge(base, override) {
  if (override === undefined) return structuredClone(base);
  if (!base || typeof base !== 'object' || Array.isArray(base)) return structuredClone(override);
  if (!override || typeof override !== 'object' || Array.isArray(override)) return structuredClone(override);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) out[key] = merge(out[key], value);
  return out;
}

function identity(input, type) {
  assertObject(input, `${type}`);
  if (!input.id) throw new Error(`${type}.id is required`);
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error(`${type}.version must be a positive integer`);
  return {
    id: input.id,
    version: input.version,
    type,
    invariants: input.invariants || [],
    allowedVariations: input.allowedVariations || [],
    forbiddenVariations: input.forbiddenVariations || [],
    definition: input.definition || {},
  };
}

function resolveContext(input) {
  assertObject(input, 'context');
  const layers = ['tenant', 'business', 'brand', 'audience', 'offering', 'strategy', 'universe', 'series', 'production'];
  const resolved = {};
  let accumulated = {};

  for (const layer of layers) {
    if (!input[layer]) continue;
    assertObject(input[layer], `context.${layer}`);
    if (!input[layer].id) throw new Error(`context.${layer}.id is required`);
    accumulated = merge(accumulated, input[layer].rules || input[layer].profile || input[layer].objective || {});
    resolved[layer] = {
      id: input[layer].id,
      version: input[layer].version || 1,
      name: input[layer].name || null,
    };
  }

  return { references: resolved, inheritedRules: accumulated };
}

function createBible(input) {
  assertObject(input, 'input');
  const context = resolveContext(input.context);

  const creativeTruth = {
    concept: input.creativeTruth.concept,
    narrative: merge(context.inheritedRules.narrative || {}, input.creativeTruth.narrative || {}),
    brandRules: merge(context.inheritedRules.brandRules || {}, input.creativeTruth.brandRules || {}),
    style: merge(context.inheritedRules.style || {}, input.creativeTruth.style || {}),
    characters: (input.creativeTruth.characters || []).map(x => identity(x, 'CHARACTER')),
    locations: (input.creativeTruth.locations || []).map(x => identity(x, 'LOCATION')),
    styles: (input.creativeTruth.styles || []).map(x => identity(x, 'STYLE')),
  };

  const productionPlan = {
    objective: input.productionPlan.objective || {},
    shots: (input.productionPlan.shots || []).map(shot => ({
      number: shot.number,
      description: shot.description || '',
      durationMs: shot.durationMs || null,
      action: shot.action || '',
      dialogue: shot.dialogue || null,
      continuityRequirements: shot.continuityRequirements || [],
      assetRefs: shot.assetRefs || [],
    })),
    assetRequirements: input.productionPlan.assetRequirements || [],
    editions: (input.productionPlan.editions || []).map(edition => ({
      platform: edition.platform,
      constraints: edition.constraints || {},
      publishing: edition.publishing || {},
    })),
  };

  const body = {
    contractVersion: BIBLE_CONTRACT_VERSION,
    version: input.version || 1,
    context,
    creativeTruth,
    productionPlan,
  };

  const id = fingerprint('bible', body);
  const result = Object.freeze({ id, ...body });
  validateBible(result);
  return result;
}

function deriveEdition(bible, platform) {
  if (!PLATFORMS.includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  const edition = bible.productionPlan.editions.find(x => x.platform === platform);
  if (!edition) throw new Error(`Bible has no edition for ${platform}`);

  const derived = {
    bibleId: bible.id,
    bibleVersion: bible.version,
    platform,
    context: bible.context,
    creativeTruth: bible.creativeTruth,
    productionPlan: {
      shots: bible.productionPlan.shots,
      assetRequirements: bible.productionPlan.assetRequirements,
      edition,
    },
  };

  return Object.freeze({
    id: fingerprint('edition', derived),
    ...derived,
  });
}

module.exports = {
  canonicalize,
  canonicalJson,
  fingerprint,
  resolveContext,
  createBible,
  deriveEdition,
};
