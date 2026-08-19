'use strict';

const crypto = require('node:crypto');

class ArtifactService {
  constructor({ storage }) {
    if (!storage) throw new Error('ArtifactService requires storage');
    this.storage = storage;
  }

  async createVersion({ artifactId, type, content, stageId, attemptId, provider, model, validationStatus = 'pending' }) {
    if (!artifactId || !type || typeof content !== 'string') {
      throw new Error('artifactId, type and string content are required');
    }

    const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const version = 1;
    const key = `artifacts/${artifactId}/v${version}.txt`;
    const stored = await this.storage.put({ key, content });

    return Object.freeze({
      artifactId,
      version,
      type,
      contentHash,
      storageKey: stored.key,
      stageId: stageId || null,
      attemptId: attemptId || null,
      provenance: Object.freeze({
        provider: provider || null,
        model: model || null,
      }),
      validationStatus,
    });
  }
}

module.exports = { ArtifactService };
