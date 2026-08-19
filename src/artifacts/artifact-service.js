'use strict';

const crypto = require('node:crypto');

class ArtifactService {
  constructor({ storage }) {
    if (!storage) throw new Error('ArtifactService requires storage');
    this.storage = storage;
  }

  async createVersion({ artifactId, type, content, stageId, attemptId, provider, model, validationStatus = 'pending' }) {
    if (!artifactId || !type || content === undefined || content === null) {
      throw new Error('artifactId, type and content are required');
    }

    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const version = await this.nextVersion(artifactId);
    const extension = type === 'text' ? 'txt' : 'bin';
    const key = `artifacts/${artifactId}/v${version}.${extension}`;
    const stored = await this.storage.put({
      key,
      bytes,
      metadata: { type, contentHash, stageId: stageId || null, attemptId: attemptId || null },
    });

    return Object.freeze({
      artifactId,
      version,
      type,
      contentHash,
      size: stored.size,
      storageKey: stored.key,
      stageId: stageId || null,
      attemptId: attemptId || null,
      provenance: Object.freeze({ provider: provider || null, model: model || null }),
      validationStatus,
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

module.exports = { ArtifactService };
