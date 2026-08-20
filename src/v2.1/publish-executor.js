const { createHash } = require('node:crypto');

const PUBLICATION_BLOCKED = 'PUBLICATION_BLOCKED';
const PUBLICATION_IN_PROGRESS = 'PUBLICATION_IN_PROGRESS';

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
  if (existing?.status === 'PUBLISHED') return { ...existing, reused: true };
  if (existing?.status === 'PUBLISHING') {
    const error = new Error(PUBLICATION_IN_PROGRESS);
    error.code = PUBLICATION_IN_PROGRESS;
    throw error;
  }

  const intent = {
    publicationKey: key,
    artifactVersionId,
    destination,
    status: 'PUBLISHING',
    result: null,
  };
  store.set(key, intent);

  try {
    const result = publisher({ artifactVersionId, destination, idempotencyKey: key });
    const record = { ...intent, status: 'PUBLISHED', result };
    store.set(key, record);
    return { ...record, reused: false };
  } catch (error) {
    store.set(key, { ...intent, status: 'FAILED', error: { message: error.message, code: error.code } });
    throw error;
  }
}

module.exports = {
  executePublication,
  publicationKey,
  PUBLICATION_BLOCKED,
  PUBLICATION_IN_PROGRESS,
};
