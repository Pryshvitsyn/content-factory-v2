const { createHash } = require('node:crypto');

const PUBLICATION_BLOCKED = 'PUBLICATION_BLOCKED';

function publicationKey({ artifactVersionId, destination, idempotencyKey }) {
  const raw = idempotencyKey || `${artifactVersionId}:${destination}`;
  return createHash('sha256').update(raw).digest('hex');
}

function executePublication({ artifactVersionId, destination, gate, idempotencyKey, store, publisher }) {
  if (!gate || gate.allowed !== true) {
    const error = new Error(PUBLICATION_BLOCKED);
    error.code = PUBLICATION_BLOCKED;
    throw error;
  }

  const key = publicationKey({ artifactVersionId, destination, idempotencyKey });
  const existing = store.get(key);
  if (existing) return { ...existing, reused: true };

  const result = publisher({ artifactVersionId, destination });
  const record = {
    publicationKey: key,
    artifactVersionId,
    destination,
    status: 'PUBLISHED',
    result,
  };
  store.set(key, record);
  return { ...record, reused: false };
}

module.exports = { executePublication, publicationKey, PUBLICATION_BLOCKED };
