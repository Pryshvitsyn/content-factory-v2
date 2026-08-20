'use strict';

const assert = require('node:assert/strict');
const { RecoveryExecutor } = require('../worker/v2.1-recovery-executor');

async function run() {
  const calls = [];
  const executor = new RecoveryExecutor({
    reconcile: async () => ({ delivery: 'CONFIRMED' }),
    confirm: async () => calls.push('confirm'),
    safeRetry: async () => calls.push('retry'),
    defer: async () => calls.push('defer'),
    fail: async () => calls.push('fail'),
    clock: () => new Date('2026-08-20T20:00:00Z'),
  });

  const result = await executor.run({
    publication: { id: 'pub-1', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 1, maxAttempts: 3 },
    workerId: 'worker-a',
    leaseExpiresAt: new Date('2026-08-20T20:05:00Z'),
  });
  assert.equal(result.action, 'CONFIRM');
  assert.deepEqual(calls, ['confirm']);

  let reconcileCalls = 0;
  const expiredBeforeLookup = new RecoveryExecutor({
    reconcile: async () => { reconcileCalls += 1; return { delivery: 'CONFIRMED' }; },
    confirm: async () => { throw new Error('confirm must not run'); },
    safeRetry: async () => { throw new Error('retry must not run'); },
    defer: async () => { throw new Error('defer must not run'); },
    fail: async () => { throw new Error('fail must not run'); },
    clock: () => new Date('2026-08-20T20:00:00Z'),
  });
  await assert.rejects(
    () => expiredBeforeLookup.run({
      publication: { id: 'pub-expired', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 1, maxAttempts: 3 },
      workerId: 'worker-a',
      leaseExpiresAt: new Date('2026-08-20T19:59:00Z'),
    }),
    /valid, unexpired worker lease/
  );
  assert.equal(reconcileCalls, 0);

  let current = new Date('2026-08-20T20:00:00Z');
  const lostDuringLookupCalls = [];
  const lostDuringLookup = new RecoveryExecutor({
    reconcile: async () => {
      current = new Date('2026-08-20T20:06:00Z');
      return { delivery: 'CONFIRMED' };
    },
    confirm: async () => lostDuringLookupCalls.push('confirm'),
    safeRetry: async () => lostDuringLookupCalls.push('retry'),
    defer: async () => lostDuringLookupCalls.push('defer'),
    fail: async () => lostDuringLookupCalls.push('fail'),
    clock: () => current,
  });
  await assert.rejects(
    () => lostDuringLookup.run({
      publication: { id: 'pub-lost', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 1, maxAttempts: 3 },
      workerId: 'worker-a',
      leaseExpiresAt: new Date('2026-08-20T20:05:00Z'),
    }),
    /valid, unexpired worker lease/
  );
  assert.deepEqual(lostDuringLookupCalls, []);

  const deferredCalls = [];
  const deferred = new RecoveryExecutor({
    reconcile: async () => ({ delivery: 'UNKNOWN' }),
    confirm: async () => deferredCalls.push('confirm'),
    safeRetry: async () => deferredCalls.push('retry'),
    defer: async () => deferredCalls.push('defer'),
    fail: async () => deferredCalls.push('fail'),
    clock: () => new Date('2026-08-20T20:00:00Z'),
  });
  const deferredResult = await deferred.run({
    publication: { id: 'pub-2', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 2, maxAttempts: 3 },
  });
  assert.equal(deferredResult.action, 'DEFER');
  assert.deepEqual(deferredCalls, ['defer']);

  const noop = await executor.run({
    publication: { id: 'pub-4', deliveryState: 'CONFIRMED', executionStatus: 'SUCCEEDED' },
  });
  assert.equal(noop.action, 'NOOP');

  console.log('V2.1 recovery executor certification: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
