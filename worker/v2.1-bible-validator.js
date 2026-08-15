'use strict';

const { CONTRACT, PLATFORMS, ASSET_TYPES } = require('./v2.1-bible-contract');

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
}

function nonEmpty(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string');
}

function idRef(value, path) {
  nonEmpty(value, path);
}

function oneOf(value, values, path) {
  if (!values.includes(value)) fail(path, `must be one of ${values.join(', ')}`);
}

function validateContext(context) {
  object(context, 'context');
  object(context.references, 'context.references');
  object(context.inheritedRules, 'context.inheritedRules');

  for (const layer of ['tenant', 'business', 'brand']) {
    object(context.references[layer], `context.references.${layer}`);
    idRef(context.references[layer].id, `context.references.${layer}.id`);
    if (!Number.isInteger(context.references[layer].version) || context.references[layer].version < 1) {
      fail(`context.references.${layer}.version`, 'must be a positive integer');
    }
  }

  for (const layer of ['audience', 'offering', 'strategy', 'universe', 'series', 'production']) {
    const ref = context.references[layer];
    if (!ref) continue;
    object(ref, `context.references.${layer}`);
    idRef(ref.id, `context.references.${layer}.id`);
    if (!Number.isInteger(ref.version) || ref.version < 1) {
      fail(`context.references.${layer}.version`, 'must be a positive integer');
    }
  }
}

function validateIdentity(identity, path) {
  object(identity, path);
  idRef(identity.id, `${path}.id`);
  if (!Number.isInteger(identity.version) || identity.version < 1) {
    fail(`${path}.version`, 'must be a positive integer');
  }
  if (identity.invariants !== undefined && !Array.isArray(identity.invariants)) {
    fail(`${path}.invariants`, 'must be an array');
  }
  if (identity.allowedVariations !== undefined && !Array.isArray(identity.allowedVariations)) {
    fail(`${path}.allowedVariations`, 'must be an array');
  }
  if (identity.forbiddenVariations !== undefined && !Array.isArray(identity.forbiddenVariations)) {
    fail(`${path}.forbiddenVariations`, 'must be an array');
  }
}

function validateAssetRef(ref, path) {
  object(ref, path);
  idRef(ref.id, `${path}.id`);
  oneOf(ref.type, ASSET_TYPES, `${path}.type`);
  if (ref.version !== undefined && (!Number.isInteger(ref.version) || ref.version < 1)) {
    fail(`${path}.version`, 'must be a positive integer when provided');
  }
}

function validateBible(bible) {
  object(bible, 'bible');
  if (bible.contractVersion !== CONTRACT.version) {
    fail('bible.contractVersion', `must equal ${CONTRACT.version}`);
  }
  idRef(bible.id, 'bible.id');
  if (!Number.isInteger(bible.version) || bible.version < 1) fail('bible.version', 'must be a positive integer');
  validateContext(bible.context);

  object(bible.creativeTruth, 'bible.creativeTruth');
  object(bible.creativeTruth.narrative, 'bible.creativeTruth.narrative');
  object(bible.creativeTruth.brandRules, 'bible.creativeTruth.brandRules');
  object(bible.creativeTruth.style, 'bible.creativeTruth.style');

  for (const key of ['characters', 'locations', 'styles']) {
    if (!Array.isArray(bible.creativeTruth[key])) fail(`bible.creativeTruth.${key}`, 'must be an array');
  }
  bible.creativeTruth.characters.forEach((x, i) => validateIdentity(x, `bible.creativeTruth.characters[${i}]`));
  bible.creativeTruth.locations.forEach((x, i) => validateIdentity(x, `bible.creativeTruth.locations[${i}]`));
  bible.creativeTruth.styles.forEach((x, i) => validateIdentity(x, `bible.creativeTruth.styles[${i}]`));

  object(bible.productionPlan, 'bible.productionPlan');
  if (!Array.isArray(bible.productionPlan.shots) || bible.productionPlan.shots.length === 0) {
    fail('bible.productionPlan.shots', 'must contain at least one shot');
  }
  if (!Array.isArray(bible.productionPlan.assetRequirements)) fail('bible.productionPlan.assetRequirements', 'must be an array');
  if (!Array.isArray(bible.productionPlan.editions) || bible.productionPlan.editions.length === 0) fail('bible.productionPlan.editions', 'must contain at least one edition');

  const numbers = bible.productionPlan.shots.map((shot, i) => {
    object(shot, `bible.productionPlan.shots[${i}]`);
    if (!Number.isInteger(shot.number) || shot.number < 1) fail(`bible.productionPlan.shots[${i}].number`, 'must be a positive integer');
    if (!Array.isArray(shot.assetRefs)) fail(`bible.productionPlan.shots[${i}].assetRefs`, 'must be an array');
    shot.assetRefs.forEach((ref, j) => validateAssetRef(ref, `bible.productionPlan.shots[${i}].assetRefs[${j}]`));
    return shot.number;
  });
  if (new Set(numbers).size !== numbers.length) fail('bible.productionPlan.shots', 'shot numbers must be unique');
  if (numbers.some((n, i) => n !== i + 1)) fail('bible.productionPlan.shots', 'shot numbers must be deterministic and contiguous from 1');

  bible.productionPlan.editions.forEach((edition, i) => {
    object(edition, `bible.productionPlan.editions[${i}]`);
    oneOf(edition.platform, PLATFORMS, `bible.productionPlan.editions[${i}].platform`);
    object(edition.constraints || {}, `bible.productionPlan.editions[${i}].constraints`);
  });

  if (bible.providerConfig !== undefined) fail('bible.providerConfig', 'provider configuration must not be part of the creative contract');
  return true;
}

module.exports = { validateBible };
