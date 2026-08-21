'use strict';

const assert = require('node:assert/strict');
const { reconcilePublication } = require('../src/v2.1/publication-reconciliation-worker');

async function main() {
  const events = [];
  const worker = reconcilePublication({
    publication: { status: 'UNKNOWN', attempt: 1, maxAttempts: 3 },
    workerId: 'worker-a',
    leaseExpiresAt: new Date(Date.now() + 60_000),
    now: new Date(),
    lookup: async () => 'NOT_FOUND',
    confirm: async () => events.push('CONFIRM'),
    retry: async () => events.push('RETRY'),
    fail: async () => events.push('FAIL'),
    defer: async () => events.push('DEFER'),
  });
  assert.equal((await worker).action, 'SAFE_RETRY');
  assert.deepEqual(events, ['RETRY']);

  await assert.rejects(
    () => reconcilePublication({
      publication: { status: 'UNKNOWN', attempt: 1, maxAttempts: 3 },
      workerId: 'worker-a',
      leaseExpiresAt: new Date(Date.now() - 1),
      lookup: async () => 'CONFIRMED',
      confirm: async () => {}, retry: async () => {}, fail: async () => {}, defer: async () => {},
    }),
    (error) => error.code === 'WORKER_LEASE_EXPIRED',
  );

  console.log('v2.1 reconciliation worker certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
