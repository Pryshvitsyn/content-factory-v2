const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAGE_DEFINITIONS,
  EDITION_PLATFORMS,
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
} = require('../worker/v2.1-production-contract');

const { STAGES } = require('../worker/v2.1-contracts');

test('production stages are complete and ordered consistently with the global stage contract', () => {
  assert.deepEqual(Object.keys(STAGE_DEFINITIONS), STAGES);
});

test('each stage declares inputs and outputs', () => {
  for (const stage of STAGES) {
    const definition = STAGE_DEFINITIONS[stage];
    assert.ok(Array.isArray(definition.requires));
    assert.ok(Array.isArray(definition.outputs));
    assert.ok(definition.outputs.length > 0);
  }
});

test('SCRIPT requires both the canonical IDEA source and the completed CONCEPT stage', () => {
  assert.throws(
    () => assertStageDependenciesSatisfied('SCRIPT', []),
    /missing required artifacts/
  );

  assert.throws(
    () => assertStageDependenciesSatisfied('SCRIPT', ['IDEA_SET']),
    /missing required artifacts/
  );

  assert.throws(
    () => assertStageDependenciesSatisfied('SCRIPT', ['CONCEPT']),
    /missing required artifacts/
  );

  assert.equal(
    assertStageDependenciesSatisfied('SCRIPT', ['IDEA_SET', 'CONCEPT']),
    true
  );
});

test('generation and platform stages expose explicit parallelization groups', () => {
  assert.equal(getParallelGroup('ASSET_GENERATION'), 'GENERATION');
  assert.equal(getParallelGroup('PLATFORM_ADAPTATION'), 'PLATFORM');
  assert.equal(getParallelGroup('EDIT'), null);
});

test('production contract is versioned and platform-aware', () => {
  const contract = createProductionContract({
    productionId: 'production-1',
    version: 2,
    bibleVersion: 3,
    platforms: EDITION_PLATFORMS,
  });

  assert.equal(contract.productionId, 'production-1');
  assert.equal(contract.version, 2);
  assert.equal(contract.bibleVersion, 3);
  assert.deepEqual(contract.platforms, EDITION_PLATFORMS);
});

test('asset requirements are typed and explicit', () => {
  const requirement = createAssetRequirement({
    shotId: 'shot-1',
    role: 'hero_character',
    assetType: 'CHARACTER',
    constraints: { wardrobe: 'red jacket' },
  });

  assert.equal(requirement.status, 'MISSING');
  assert.equal(requirement.assetType, 'CHARACTER');
  assert.equal(requirement.constraints.wardrobe, 'red jacket');
});

test('shot contract preserves deterministic shot numbering', () => {
  const shot = createShotContract({
    shotId: 'shot-7',
    shotNumber: 7,
    durationMs: 2500,
    assetRoles: ['hero_character', 'location'],
  });

  assert.equal(shot.shotNumber, 7);
  assert.equal(shot.durationMs, 2500);
  assert.deepEqual(shot.assetRoles, ['hero_character', 'location']);
});

test('edition contract is platform-specific and versioned', () => {
  const edition = createEditionContract({
    productionId: 'production-1',
    platform: 'TIKTOK',
    version: 1,
    sourceArtifactIds: ['artifact-1', 'artifact-2'],
  });

  assert.equal(edition.platform, 'TIKTOK');
  assert.equal(edition.version, 1);
  assert.deepEqual(edition.sourceArtifactIds, ['artifact-1', 'artifact-2']);
});

test('versioned objects cannot be overwritten with the same or older version', () => {
  assert.equal(assertImmutableVersion(1, 2), true);
  assert.throws(() => assertImmutableVersion(2, 2), /version must increase/);
  assert.throws(() => assertImmutableVersion(3, 2), /version must increase/);
});

test('production cannot be marked complete before learning output exists', () => {
  assert.throws(
    () => assertProductionCompletable(['PUBLICATIONS', 'PERFORMANCE_DATA']),
    /missing: LEARNINGS/
  );

  assert.equal(
    assertProductionCompletable(['PUBLICATIONS', 'PERFORMANCE_DATA', 'LEARNINGS']),
    true
  );
});

test('stage outputs define the factory handoff vocabulary', () => {
  assert.deepEqual(getRequiredArtifacts('BIBLE'), ['SCRIPT']);
  assert.deepEqual(getStageOutputs('BIBLE'), ['PRODUCTION_BIBLE']);
  assert.deepEqual(getStageOutputs('ASSET_GENERATION'), ['ASSETS']);
  assert.deepEqual(getStageOutputs('LEARN'), ['LEARNINGS']);
});
