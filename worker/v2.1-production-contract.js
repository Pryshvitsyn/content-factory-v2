const STAGE_DEFINITIONS = Object.freeze({
  SIGNAL: Object.freeze({ requires: [], outputs: ['SIGNAL_SET'], parallelGroup: null }),
  IDEA: Object.freeze({ requires: ['SIGNAL_SET'], outputs: ['IDEA_SET'], parallelGroup: null }),
  BRIEF: Object.freeze({ requires: ['IDEA_SET'], outputs: ['CONTENT_BRIEF'], parallelGroup: null }),
  CONCEPT: Object.freeze({ requires: ['CONTENT_BRIEF'], outputs: ['CONCEPT'], parallelGroup: null }),
  SCRIPT: Object.freeze({ requires: ['IDEA_SET'], outputs: ['SCRIPT'], parallelGroup: null }),
  BIBLE: Object.freeze({ requires: ['SCRIPT'], outputs: ['PRODUCTION_BIBLE'], parallelGroup: null }),
  ASSET_PLAN: Object.freeze({ requires: ['PRODUCTION_BIBLE'], outputs: ['ASSET_REQUIREMENTS'], parallelGroup: null }),
  SHOT_PLAN: Object.freeze({ requires: ['PRODUCTION_BIBLE', 'SCRIPT'], outputs: ['SHOTS'], parallelGroup: null }),
  ASSET_GENERATION: Object.freeze({ requires: ['ASSET_REQUIREMENTS'], outputs: ['ASSETS'], parallelGroup: 'GENERATION' }),
  CONTINUITY: Object.freeze({ requires: ['SHOTS', 'ASSETS', 'PRODUCTION_BIBLE'], outputs: ['CONTINUITY_REPORT'], parallelGroup: null }),
  EDIT: Object.freeze({ requires: ['SHOTS', 'ASSETS', 'CONTINUITY_REPORT'], outputs: ['EDIT'], parallelGroup: null }),
  PLATFORM_ADAPTATION: Object.freeze({ requires: ['EDIT'], outputs: ['EDITIONS'], parallelGroup: 'PLATFORM' }),
  VALIDATION: Object.freeze({ requires: ['EDITIONS'], outputs: ['VALIDATION_REPORT'], parallelGroup: null }),
  PUBLISH: Object.freeze({ requires: ['VALIDATION_REPORT', 'EDITIONS'], outputs: ['PUBLICATIONS'], parallelGroup: 'PLATFORM' }),
  ANALYZE: Object.freeze({ requires: ['PUBLICATIONS'], outputs: ['PERFORMANCE_DATA'], parallelGroup: null }),
  LEARN: Object.freeze({ requires: ['PERFORMANCE_DATA'], outputs: ['LEARNINGS'], parallelGroup: null }),
});

const PRODUCTION_STATUSES = Object.freeze(['DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
const ASSET_TYPES = Object.freeze(['CHARACTER', 'LOCATION', 'STYLE', 'VOICE', 'PROP', 'BRAND', 'PRODUCT']);
const ASSET_REQUIREMENT_STATUSES = Object.freeze(['MISSING', 'AVAILABLE', 'STALE', 'INVALID', 'SATISFIED']);
const EDITION_PLATFORMS = Object.freeze(['TIKTOK', 'INSTAGRAM_REELS', 'YOUTUBE_SHORTS', 'YOUTUBE']);
const VERSIONED_OBJECTS = Object.freeze(['PRODUCTION_BIBLE', 'ASSET_VERSION', 'ARTIFACT_VERSION', 'EDITION']);

function assertKnown(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function getStageDefinition(stage) {
  assertKnown(stage, Object.keys(STAGE_DEFINITIONS), 'stage');
  return STAGE_DEFINITIONS[stage];
}

function getRequiredArtifacts(stage) {
  return [...getStageDefinition(stage).requires];
}

function getStageOutputs(stage) {
  return [...getStageDefinition(stage).outputs];
}

function getParallelGroup(stage) {
  return getStageDefinition(stage).parallelGroup;
}

function assertStageDependenciesSatisfied(stage, availableArtifacts) {
  const available = new Set(availableArtifacts || []);
  const missing = getRequiredArtifacts(stage).filter((required) => !available.has(required));
  if (missing.length) throw new Error(`Stage ${stage} is missing required artifacts: ${missing.join(', ')}`);
  return true;
}

function createProductionContract({ productionId, version = 1, bibleVersion = 1, platforms = [] }) {
  assertNonEmptyString(productionId, 'productionId');
  assertPositiveInteger(version, 'version');
  assertPositiveInteger(bibleVersion, 'bibleVersion');
  const uniquePlatforms = [...new Set(platforms)];
  uniquePlatforms.forEach((platform) => assertKnown(platform, EDITION_PLATFORMS, 'platform'));
  return Object.freeze({
    productionId,
    version,
    bibleVersion,
    platforms: Object.freeze(uniquePlatforms),
    stages: Object.freeze(Object.keys(STAGE_DEFINITIONS)),
  });
}

function createAssetRequirement({ shotId, role, assetType, requiredAssetId = null, status = 'MISSING', constraints = {} }) {
  assertNonEmptyString(shotId, 'shotId');
  assertNonEmptyString(role, 'role');
  assertKnown(assetType, ASSET_TYPES, 'assetType');
  assertKnown(status, ASSET_REQUIREMENT_STATUSES, 'status');
  return Object.freeze({ shotId, role, assetType, requiredAssetId, status, constraints: { ...constraints } });
}

function createShotContract({ shotId, shotNumber, durationMs = null, instructions = {}, assetRoles = [] }) {
  assertNonEmptyString(shotId, 'shotId');
  assertPositiveInteger(shotNumber, 'shotNumber');
  if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs <= 0)) throw new Error('durationMs must be a positive integer or null');
  return Object.freeze({
    shotId,
    shotNumber,
    durationMs,
    instructions: { ...instructions },
    assetRoles: [...new Set(assetRoles)],
  });
}

function createEditionContract({ productionId, platform, version = 1, sourceArtifactIds = [] }) {
  assertNonEmptyString(productionId, 'productionId');
  assertKnown(platform, EDITION_PLATFORMS, 'platform');
  assertPositiveInteger(version, 'version');
  return Object.freeze({ productionId, platform, version, sourceArtifactIds: [...new Set(sourceArtifactIds)] });
}

function assertImmutableVersion(previousVersion, nextVersion) {
  assertPositiveInteger(nextVersion, 'nextVersion');
  if (previousVersion !== null && nextVersion <= previousVersion) {
    throw new Error(`version must increase: ${previousVersion} -> ${nextVersion}`);
  }
  return true;
}

function assertProductionCompletable(completedArtifacts) {
  const available = new Set(completedArtifacts || []);
  const terminalRequirements = ['LEARNINGS'];
  const missing = terminalRequirements.filter((item) => !available.has(item));
  if (missing.length) throw new Error(`Production cannot complete; missing: ${missing.join(', ')}`);
  return true;
}

module.exports = {
  STAGE_DEFINITIONS,
  PRODUCTION_STATUSES,
  ASSET_TYPES,
  ASSET_REQUIREMENT_STATUSES,
  EDITION_PLATFORMS,
  VERSIONED_OBJECTS,
  getStageDefinition,
  getRequiredArtifacts,
  getStageOutputs,
  getParallelGroup,
  assertStageDependenciesSatisfied,
  createProductionContract,
  createAssetRequirement,
  createShotContract,
  createEditionContract,
  assertImmutableVersion,
  assertProductionCompletable,
};
