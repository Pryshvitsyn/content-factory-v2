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
  });

  const result = await executor.run({
    publication: { id: 'pub-1', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 1, maxAttempts: 3 },
    workerId: 'worker-a',
    leaseExpiresAt: new Date('2026-08-20T20:05:00Z'),
    now: new Date('2026-08-20T20:00:00Z'),
  });
  assert.equal(result.action, 'CONFIRM');
  assert.deepEqual(calls, ['confirm']);

  const deferredCalls = [];
  const deferred = new RecoveryExecutor({
    reconcile: async () => ({ delivery: 'UNKNOWN' }),
    confirm: async () => deferredCalls.push('confirm'),
    safeRetry: async () => deferredCalls.push('retry'),
    defer: async () => deferredCalls.push('defer'),
    fail: async () => deferredCalls.push('fail'),
  });
  const deferredResult = await deferred.run({
    publication: { id: 'pub-2', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 2, maxAttempts: 3 },
  });
  assert.equal(deferredResult.action, 'DEFER');
  assert.deepEqual(deferredCalls, ['defer']);

  const retry = new RecoveryExecutor({
    reconcile: async () => ({ delivery: 'NOT_FOUND' }),
    confirm: async () => calls.push('confirm'),
    safeRetry: async () => calls.push('retry'),
    defer: async () => calls.push('defer'),
    fail: async () => calls.push('fail'),
  });
  await assert.rejects(
    () => retry.run({
      publication: { id: 'pub-3', deliveryState: 'UNKNOWN', executionStatus: 'RECONCILING', attempt: 1, maxAttempts: 3 },
      workerId: 'worker-a',
      leaseExpiresAt: new Date('2026-08-20T19:59:00Z'),
      now: new Date('2026-08-20T20:00:00Z'),
    }),
    /valid, unexpired worker lease/
  );
  assert.deepEqual(calls, ['confirm']);

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
