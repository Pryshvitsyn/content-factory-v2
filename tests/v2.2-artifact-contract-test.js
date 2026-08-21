'use strict';

const assert = require('node:assert/strict');
const {
  createArtifactIdentity,
  assertImmutableIdentity,
  buildLineage,
} = require('../worker/v2.2-artifact-contract');

const base = createArtifactIdentity({
  contentUnitId: 'content-1',
  revisionId: 'revision-1',
  stage: 'SCRIPT',
  artifactType: 'script',
  content: { text: 'A precise script.' },
  inputFingerprint: 'input-1',
  configuration: { temperature: 0.2 },
});

const same = createArtifactIdentity({
  contentUnitId: 'content-1',
  revisionId: 'revision-1',
  stage: 'SCRIPT',
  artifactType: 'script',
  content: { text: 'A precise script.' },
  inputFingerprint: 'input-1',
  configuration: { temperature: 0.2 },
});
assert.equal(base.artifactId, same.artifactId);
assertImmutableIdentity(base, same);

const changed = createArtifactIdentity({
  ...base,
  content: { text: 'A changed script.' },
});
assert.notEqual(base.artifactId, changed.artifactId);
assert.throws(() => assertImmutableIdentity(base, { ...base, version: 2 }), /identity mutation/);

const parent = createArtifactIdentity({
  contentUnitId: 'content-1',
  revisionId: 'revision-1',
  stage: 'IDEA',
  artifactType: 'idea',
  content: { text: 'idea' },
});
const lineage = buildLineage(base, [parent, parent, null]);
assert.deepEqual(lineage, [{ artifactId: base.artifactId, parentArtifactId: parent.artifactId, relationship: 'derived_from' }]);
assert.throws(() => buildLineage(base, [base]), /own parent/);

console.log('V2.2 artifact identity and lineage contract: PASS');
