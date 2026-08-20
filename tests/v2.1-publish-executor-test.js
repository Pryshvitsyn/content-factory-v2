const assert = require('node:assert/strict');
const { executePublication, PUBLICATION_BLOCKED } = require('../src/v2.1/publish-executor');

function run() {
  const store = new Map();
  let calls = 0;
  const publisher = ({ artifactVersionId, destination }) => {
    calls += 1;
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

  assert.throws(
    () => executePublication({
      artifactVersionId: 'av-2', destination: 'channel-a', gate: { allowed: false }, store, publisher,
    }),
    (error) => error.code === PUBLICATION_BLOCKED,
  );

  console.log('V2.1 publish executor certification: PASS');
}

run();
