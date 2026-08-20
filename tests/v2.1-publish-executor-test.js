const assert = require('node:assert/strict');
const {
  executePublication,
  PUBLICATION_BLOCKED,
  PUBLICATION_IN_PROGRESS,
} = require('../src/v2.1/publish-executor');

function run() {
  const store = new Map();
  let calls = 0;
  const publisher = ({ artifactVersionId, destination, idempotencyKey }) => {
    calls += 1;
    assert.ok(idempotencyKey, 'publisher must receive stable idempotency key');
    return { externalId: `${destination}:${artifactVersionId}` };
  };

  const gate = { allowed: true };
  const first = executePublication({
    artifactVersionId: 'av-1', destination: 'channel-a', gate, store, publisher,
  });
  const second = executePublication({
    artifactVersionId: 'av-1', destination: 'channel-a', gate, store, publisher,
  });

  assert.equal(first.status, 'PUBLISHED');
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(calls, 1, 'idempotent publication must call publisher once');

  store.set(first.publicationKey, { ...first, status: 'PUBLISHING' });
  assert.throws(
    () => executePublication({
      artifactVersionId: 'av-1', destination: 'channel-a', gate, store, publisher,
    }),
    (error) => error.code === PUBLICATION_IN_PROGRESS,
  );
  assert.equal(calls, 1, 'in-flight publication must not be duplicated');

  assert.throws(
    () => executePublication({
      artifactVersionId: 'av-2', destination: 'channel-a', gate: { allowed: false }, store, publisher,
    }),
    (error) => error.code === PUBLICATION_BLOCKED,
  );

  const failingStore = new Map();
  const failure = new Error('destination unavailable');
  assert.throws(
    () => executePublication({
      artifactVersionId: 'av-3', destination: 'channel-a', gate, store: failingStore,
      publisher: () => { throw failure; },
    }),
    (error) => error === failure,
  );
  assert.equal(failingStore.values().next().value.status, 'FAILED');

  console.log('V2.1 publish executor certification: PASS');
}

run();
