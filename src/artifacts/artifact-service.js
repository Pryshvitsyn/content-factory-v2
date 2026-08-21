'use strict';

const crypto = require('node:crypto');

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
      if (existingHash !== contentHash) {
        throw new Error('Artifact idempotency conflict: existing content differs');
      }
      return Object.freeze({
        artifactId,
        version: 1,
        type,
        contentHash,
        size: existing.length,
        storageKey: deterministicKey,
        stageId: stageId || null,
        attemptId: attemptId || null,
        provenance: Object.freeze({ provider: provider || null, model: model || null }),
        validationStatus,
        idempotent: true,
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
      });
    } catch (error) {
      if (deterministicKey && error.code === 'EEXIST') {
        const existing = await this.storage.get({ key: deterministicKey });
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingHash !== contentHash) throw new Error('Artifact idempotency conflict: existing content differs');
        return Object.freeze({
          artifactId,
          version: 1,
          type,
          contentHash,
          size: existing.length,
          storageKey: deterministicKey,
          stageId: stageId || null,
          attemptId: attemptId || null,
          provenance: Object.freeze({ provider: provider || null, model: model || null }),
          validationStatus,
          idempotent: true,
        });
      }
      throw error;
    }
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

module.exports = { ArtifactService };
