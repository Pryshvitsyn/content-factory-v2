const assert = require('node:assert/strict');
const {
  executePublication,
  PUBLICATION_BLOCKED,
  PUBLICATION_IN_PROGRESS,
  PUBLICATION_REJECTED,
} = require('../src/v2.1/publish-executor');

function run() {
  const store = new Map();
  let calls = 0;
  const publisher = ({ artifactVersionId, destination, idempotencyKey }) => {
    calls += 1;
    assert.ok(idempotencyKey, 'publisher must receive stable idempotency key');
    return { delivery: 'CONFIRMED', externalId: `${destination}:${artifactVersionId}` };
  };

  const gate = { allowed: true };
  const first = executePublication({
    artifactVersionId: 'av-1', destination: 'channel-a', gate, store, publisher,
  });
  const second = executePublication({
    artifactVersionId: 'av-1', destination: 'channel-a', gate, store, publisher,
  });

  assert.equal(first.status, 'PUBLISHED');
  assert.equal(first.deliveryState, 'CONFIRMED');
  assert.equal(first.executionStatus, 'COMPLETED');
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

  const acceptedStore = new Map();
  const accepted = executePublication({
    artifactVersionId: 'av-accepted', destination: 'channel-a', gate, store: acceptedStore,
    publisher: () => ({ delivery: 'ACCEPTED', externalId: 'provider-1' }),
  });
  assert.equal(accepted.status, 'UNKNOWN');
  assert.equal(accepted.deliveryState, 'UNKNOWN');
  assert.equal(accepted.executionStatus, 'RECONCILING');
  assert.equal(accepted.result.delivery, 'ACCEPTED');

  const unknownStore = new Map();
  const unknown = executePublication({
    artifactVersionId: 'av-unknown', destination: 'channel-a', gate, store: unknownStore,
    publisher: () => ({ delivery: 'UNKNOWN' }),
  });
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.deliveryState, 'UNKNOWN');
  assert.equal(unknown.executionStatus, 'RECONCILING');

  const ambiguousErrorStore = new Map();
  const ambiguousError = new Error('provider timeout after request');
  ambiguousError.code = 'UNKNOWN';
  const recoveredFromAmbiguity = executePublication({
    artifactVersionId: 'av-timeout', destination: 'channel-a', gate, store: ambiguousErrorStore,
    publisher: () => { throw ambiguousError; },
  });
  assert.equal(recoveredFromAmbiguity.status, 'UNKNOWN');
  assert.equal(recoveredFromAmbiguity.deliveryState, 'UNKNOWN');
  assert.equal(recoveredFromAmbiguity.executionStatus, 'RECONCILING');
  assert.equal(ambiguousErrorStore.values().next().value.error.code, 'UNKNOWN');

  const rejectedStore = new Map();
  const rejected = new Error('destination rejected publication');
  assert.throws(
    () => executePublication({
      artifactVersionId: 'av-rejected', destination: 'channel-a', gate, store: rejectedStore,
      publisher: () => ({ delivery: 'REJECTED' }),
    }),
    (error) => error.code === PUBLICATION_REJECTED,
  );
  assert.equal(rejectedStore.values().next().value.status, 'FAILED');
  assert.equal(rejectedStore.values().next().value.executionStatus, 'FAILED');

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
  assert.equal(failingStore.values().next().value.executionStatus, 'FAILED');

  console.log('V2.1 publish executor certification: PASS');
}

run();
