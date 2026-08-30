'use strict';

const crypto = require('node:crypto');

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

function jsonSemanticHash(bytes) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
    return crypto.createHash('sha256').update(JSON.stringify(stableJson(parsed))).digest('hex');
  } catch {
    return null;
  }
}

function semanticallyEquivalent({ type, existing, incoming }) {
  if (type !== 'text') return false;
  const existingSemanticHash = jsonSemanticHash(existing);
  const incomingSemanticHash = jsonSemanticHash(incoming);
  return Boolean(existingSemanticHash && incomingSemanticHash && existingSemanticHash === incomingSemanticHash);
}

function idempotencyConflict({ artifactId, type, storageKey, existingHash, incomingHash }) {
  const error = new Error(`Artifact idempotency conflict: existing content differs (${artifactId})`);
  error.code = 'ARTIFACT_IDEMPOTENCY_CONFLICT';
  error.details = Object.freeze({ artifactId, type, storageKey, existingHash, incomingHash });
  return error;
}

class ArtifactService {
  constructor({ storage }) {
    if (!storage) throw new Error('ArtifactService requires storage');
    this.storage = storage;
  }

  async createVersion({ artifactId, type, content, stageId, attemptId, idempotencyKey = null, provider, model, validationStatus = 'pending' }) {
    if (!artifactId || !type || content === undefined || content === null) {
      throw new Error('artifactId, type and content are required');
    }

    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const extension = type === 'text' ? 'txt' : 'bin';
    const deterministicKey = idempotencyKey
      ? `artifacts/${artifactId}/idempotency/${crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex')}.${extension}`
      : null;

    if (deterministicKey && await this.storage.exists({ key: deterministicKey })) {
      const existing = await this.storage.get({ key: deterministicKey });
      const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
      const semanticEquivalent = existingHash !== contentHash && semanticallyEquivalent({ type, existing, incoming: bytes });
      if (existingHash !== contentHash && !semanticEquivalent) {
        throw idempotencyConflict({ artifactId, type, storageKey: deterministicKey, existingHash, incomingHash: contentHash });
      }
      return Object.freeze({
        artifactId,
        version: 1,
        type,
        contentHash: existingHash,
        size: existing.length,
        storageKey: deterministicKey,
        stageId: stageId || null,
        attemptId: attemptId || null,
        provenance: Object.freeze({ provider: provider || null, model: model || null }),
        validationStatus,
        idempotent: true,
        semanticEquivalent,
      });
    }

    const version = await this.nextVersion(artifactId);
    const key = deterministicKey || `artifacts/${artifactId}/v${version}.${extension}`;
    try {
      const stored = await this.storage.put({
        key,
        bytes,
        metadata: { type, contentHash, stageId: stageId || null, attemptId: attemptId || null, idempotencyKey },
      });

      return Object.freeze({
        artifactId,
        version: deterministicKey ? 1 : version,
        type,
        contentHash,
        size: stored.size,
        storageKey: stored.key,
        stageId: stageId || null,
        attemptId: attemptId || null,
        provenance: Object.freeze({ provider: provider || null, model: model || null }),
        validationStatus,
        idempotent: false,
        semanticEquivalent: false,
      });
    } catch (error) {
      if (deterministicKey && error.code === 'EEXIST') {
        const existing = await this.storage.get({ key: deterministicKey });
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
        const semanticEquivalent = existingHash !== contentHash && semanticallyEquivalent({ type, existing, incoming: bytes });
        if (existingHash !== contentHash && !semanticEquivalent) {
          throw idempotencyConflict({ artifactId, type, storageKey: deterministicKey, existingHash, incomingHash: contentHash });
        }
        return Object.freeze({
          artifactId,
          version: 1,
          type,
          contentHash: existingHash,
          size: existing.length,
          storageKey: deterministicKey,
          stageId: stageId || null,
          attemptId: attemptId || null,
          provenance: Object.freeze({ provider: provider || null, model: model || null }),
          validationStatus,
          idempotent: true,
          semanticEquivalent,
        });
      }
      throw error;
    }
  }

  async getVersionByIdempotency({ artifactId, type, idempotencyKey, provider, model, validationStatus = 'pending' } = {}) {
    if (!artifactId || !type || !idempotencyKey) throw new Error('artifactId, type and idempotencyKey are required');
    const extension = type === 'text' ? 'txt' : 'bin';
    const storageKey = `artifacts/${artifactId}/idempotency/${crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex')}.${extension}`;
    if (!await this.storage.exists({ key: storageKey })) return null;
    const content = await this.storage.get({ key: storageKey });
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    return Object.freeze({
      artifactId,
      version: 1,
      type,
      content,
      contentHash,
      size: content.length,
      storageKey,
      stageId: null,
      attemptId: null,
      provenance: Object.freeze({ provider: provider || null, model: model || null }),
      validationStatus,
      idempotent: true,
    });
  }

  async nextVersion(artifactId) {
    let version = 1;
    while (await this.storage.exists({ key: `artifacts/${artifactId}/v${version}.txt` }) ||
           await this.storage.exists({ key: `artifacts/${artifactId}/v${version}.bin` })) {
      version += 1;
    }
    return version;
  }
}

module.exports = { ArtifactService, jsonSemanticHash, semanticallyEquivalent };
