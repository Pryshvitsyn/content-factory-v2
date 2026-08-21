const { createHash } = require('node:crypto');

const PUBLICATION_BLOCKED = 'PUBLICATION_BLOCKED';
const PUBLICATION_IN_PROGRESS = 'PUBLICATION_IN_PROGRESS';
const PUBLICATION_REJECTED = 'PUBLICATION_REJECTED';
const AMBIGUOUS_DELIVERY_STATES = new Set(['ACCEPTED', 'UNKNOWN']);

function publicationKey({ artifactVersionId, destination, idempotencyKey }) {
  const raw = idempotencyKey || `${artifactVersionId}:${destination}`;
  return createHash('sha256').update(raw).digest('hex');
}

function buildIntent({ artifactVersionId, destination, key }) {
  return {
    publicationKey: key,
    artifactVersionId,
    destination,
    status: 'PUBLISHING',
    deliveryState: null,
    executionStatus: 'EXECUTING',
    result: null,
  };
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
  const intent = buildIntent({ artifactVersionId, destination, key });
  store.set(key, intent);
  return executeClaimedPublication({ intent, publisher, store });
}

async function executePublicationWithDb({ artifactVersionId, destination, gate, idempotencyKey, db, publisher }) {
  if (!gate || gate.allowed !== true) {
    const error = new Error(PUBLICATION_BLOCKED);
    error.code = PUBLICATION_BLOCKED;
    throw error;
  }
  if (!db || typeof db.query !== 'function') throw new Error('db client is required');

  const key = publicationKey({ artifactVersionId, destination, idempotencyKey });
  const claim = await db.query(
    'SELECT v2_1.claim_publication($1,$2,$3) AS claim',
    [artifactVersionId, destination, key],
  );
  const payload = claim.rows[0]?.claim;
  if (!payload) throw new Error('Publication claim returned no result');
  const row = payload.publication;
  if (!row) throw new Error('Publication claim returned no publication');

  if (!payload.claimed) {
    if (row.status === 'PUBLISHED') return { ...row, reused: true };
    const error = new Error(PUBLICATION_IN_PROGRESS);
    error.code = PUBLICATION_IN_PROGRESS;
    throw error;
  }

  const intent = {
    publicationKey: row.publication_key,
    artifactVersionId: row.artifact_version_id,
    destination: row.destination,
    status: 'PUBLISHING',
    deliveryState: null,
    executionStatus: 'EXECUTING',
    result: null,
  };

  try {
    const result = await publisher({ artifactVersionId, destination, idempotencyKey: key });
    const delivery = result?.delivery;
    if (AMBIGUOUS_DELIVERY_STATES.has(delivery)) {
      const updated = await db.query(
        `UPDATE v2_1.publications SET status='UNKNOWN', result=$2, updated_at=now()
         WHERE publication_key=$1 RETURNING *`,
        [key, JSON.stringify(result)],
      );
      return { ...(updated.rows[0] || intent), reused: false };
    }
    if (delivery === 'REJECTED') {
      const error = new Error(PUBLICATION_REJECTED);
      error.code = PUBLICATION_REJECTED;
      error.result = result;
      throw error;
    }
    const updated = await db.query(
      `UPDATE v2_1.publications
       SET status='PUBLISHED', external_id=$2, result=$3, published_at=now(), updated_at=now()
       WHERE publication_key=$1 RETURNING *`,
      [key, result?.remoteId || result?.externalId || null, JSON.stringify(result)],
    );
    return { ...(updated.rows[0] || intent), reused: false };
  } catch (error) {
    if (error?.delivery === 'UNKNOWN' || error?.code === 'UNKNOWN') {
      const updated = await db.query(
        `UPDATE v2_1.publications
         SET status='UNKNOWN', result=$2, error=$3, updated_at=now()
         WHERE publication_key=$1 RETURNING *`,
        [key, JSON.stringify(error.result || null), JSON.stringify({ message: error.message, code: error.code })],
      );
      return { ...(updated.rows[0] || intent), reused: false };
    }
    await db.query(
      `UPDATE v2_1.publications SET status='FAILED', error=$2, updated_at=now() WHERE publication_key=$1`,
      [key, JSON.stringify({ message: error.message, code: error.code })],
    );
    throw error;
  }
}

function executeClaimedPublication({ intent, publisher, store }) {
  try {
    const result = publisher({ artifactVersionId: intent.artifactVersionId, destination: intent.destination, idempotencyKey: intent.publicationKey });
    const delivery = result?.delivery;
    if (AMBIGUOUS_DELIVERY_STATES.has(delivery)) {
      const record = { ...intent, status: 'UNKNOWN', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', result };
      store.set(intent.publicationKey, record);
      return { ...record, reused: false };
    }
    if (delivery === 'REJECTED') {
      const error = new Error(PUBLICATION_REJECTED);
      error.code = PUBLICATION_REJECTED;
      error.result = result;
      throw error;
    }
    const record = { ...intent, status: 'PUBLISHED', deliveryState: 'CONFIRMED', executionStatus: 'COMPLETED', result };
    store.set(intent.publicationKey, record);
    return { ...record, reused: false };
  } catch (error) {
    if (error?.delivery === 'UNKNOWN' || error?.code === 'UNKNOWN') {
      const record = { ...intent, status: 'UNKNOWN', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', error: { message: error.message, code: error.code } };
      store.set(intent.publicationKey, record);
      return { ...record, reused: false };
    }
    store.set(intent.publicationKey, { ...intent, status: 'FAILED', deliveryState: 'UNKNOWN', executionStatus: 'FAILED', error: { message: error.message, code: error.code } });
    throw error;
  }
}

module.exports = {
  executePublication,
  executePublicationWithDb,
  publicationKey,
  PUBLICATION_BLOCKED,
  PUBLICATION_IN_PROGRESS,
  PUBLICATION_REJECTED,
};
