'use strict';

const crypto = require('node:crypto');
const { stableStringify, fingerprint } = require('./v2.1-execution-engine');

const IMMUTABLE_FIELDS = Object.freeze([
  'artifactId',
  'contentUnitId',
  'revisionId',
  'stage',
  'artifactType',
  'version',
  'contentHash',
  'inputFingerprint',
  'configurationHash',
]);

function createArtifactIdentity({ contentUnitId, revisionId, stage, artifactType, version = 1, content, inputFingerprint = null, configuration = {} } = {}) {
  if (!contentUnitId || !revisionId || !stage || !artifactType) throw new Error('contentUnitId, revisionId, stage and artifactType are required');
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer');

  const contentHash = fingerprint(content);
  const configurationHash = fingerprint(configuration);
  const identityPayload = {
    contentUnitId,
    revisionId,
    stage,
    artifactType,
    version,
    contentHash,
    inputFingerprint,
    configurationHash,
  };

  const artifactId = crypto.createHash('sha256').update(stableStringify(identityPayload)).digest('hex');
  return Object.freeze({ artifactId, ...identityPayload });
}

function assertImmutableIdentity(previous, next) {
  for (const field of IMMUTABLE_FIELDS) {
    if (previous?.[field] !== next?.[field]) throw new Error(`Artifact identity mutation detected: ${field}`);
  }
  return true;
}

function buildLineage(artifact, parents = []) {
  if (!artifact?.artifactId) throw new Error('artifact is required');
  if (!Array.isArray(parents)) throw new Error('parents must be an array');
  const unique = [...new Set(parents.map((parent) => parent?.artifactId).filter(Boolean))];
  if (unique.includes(artifact.artifactId)) throw new Error('artifact cannot be its own parent');
  return Object.freeze(unique.map((parentArtifactId) => ({
    artifactId: artifact.artifactId,
    parentArtifactId,
    relationship: 'derived_from',
  })));
}

module.exports = { IMMUTABLE_FIELDS, createArtifactIdentity, assertImmutableIdentity, buildLineage };
