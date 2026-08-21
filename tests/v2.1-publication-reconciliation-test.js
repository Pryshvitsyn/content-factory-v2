'use strict';

const assert = require('node:assert/strict');
const { classify, assertMutationOwnership, backoffMs } = require('../src/v2.1/publication-reconciliation');

assert.deepEqual(classify({ status: 'CONFIRMED', attempt: 1, maxAttempts: 3 }), { action: 'CONFIRMED', terminal: true });
assert.deepEqual(classify({ status: 'NOT_FOUND', attempt: 1, maxAttempts: 3 }), { action: 'SAFE_RETRY', terminal: false });
assert.deepEqual(classify({ status: 'NOT_FOUND', attempt: 3, maxAttempts: 3 }), { action: 'FAIL', terminal: true });
assert.deepEqual(classify({ status: 'UNKNOWN', attempt: 1, maxAttempts: 3 }), { action: 'DEFER', terminal: false });

assert.throws(
  () => assertMutationOwnership({ workerId: 'worker-a', leaseExpiresAt: '2026-08-21T20:00:00Z', now: '2026-08-21T20:01:00Z' }),
  (error) => error.code === 'WORKER_LEASE_EXPIRED',
);
assert.doesNotThrow(() => assertMutationOwnership({ workerId: 'worker-a', leaseExpiresAt: '2026-08-21T20:02:00Z', now: '2026-08-21T20:01:00Z' }));
assert.equal(backoffMs({ attempt: 1 }), 1000);
assert.equal(backoffMs({ attempt: 10 }), 60000);

console.log('v2.1 publication reconciliation certification passed');
