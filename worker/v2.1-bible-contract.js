'use strict';

const BIBLE_CONTRACT_VERSION = 2;

const PLATFORMS = Object.freeze([
  'TIKTOK',
  'INSTAGRAM_REELS',
  'YOUTUBE_SHORTS',
  'YOUTUBE',
]);

const LAYERS = Object.freeze([
  'TENANT',
  'BUSINESS',
  'BRAND',
  'AUDIENCE',
  'OFFERING',
  'STRATEGY',
  'UNIVERSE',
  'SERIES',
  'PRODUCTION',
]);

const ASSET_TYPES = Object.freeze([
  'CHARACTER',
  'LOCATION',
  'STYLE',
  'VOICE',
  'PROP',
  'BRAND',
  'PRODUCT',
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

const CONTRACT = freeze({
  version: BIBLE_CONTRACT_VERSION,
  layers: LAYERS,
  platforms: PLATFORMS,
  assetTypes: ASSET_TYPES,
  principles: [
    'creative_truth_is_separate_from_production_instructions',
    'context_is_inherited_from_tenant_to_production',
    'identity_is_separate_from_asset_representation',
    'ai_providers_are_not_part_of_creative_truth',
    'resolved_bibles_are_immutable',
    'business_learning_is_scoped_and_not_global_by_default',
  ],
});

module.exports = {
  BIBLE_CONTRACT_VERSION,
  PLATFORMS,
  LAYERS,
  ASSET_TYPES,
  CONTRACT,
};
