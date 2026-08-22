const assert = require('node:assert/strict');
const { executePublication } = require('../src/v2.1/publish-executor');

async function main() {
  const store = new Map();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const publisher = async ({ idempotencyKey }) => {
    calls += 1;
    assert.ok(idempotencyKey);
    await gate;
    return { delivery: 'CONFIRMED', remoteId: 'remote-1' };
  };

  const args = {
    artifactVersionId: 'artifact-1',
    destination: 'test-destination',
    idempotencyKey: 'publication-1',
    gate: { allowed: true },
    store,
    publisher,
  };

  const attempts = Array.from({ length: 10 }, () =>
    Promise.resolve().then(() => executePublication(args))
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, 'only one concurrent caller may invoke the publisher');
  release();

  const results = await Promise.allSettled(attempts);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one caller completes publication');
  assert.equal(rejected.length, 9, 'all competing callers must be rejected while publishing');
  assert.ok(rejected.every((r) => r.reason?.code === 'PUBLICATION_IN_PROGRESS'));
  assert.equal(store.get('publication-1').status, 'PUBLISHED');
  assert.equal(calls, 1);

  console.log('v2.1 concurrent publication idempotency certification passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
