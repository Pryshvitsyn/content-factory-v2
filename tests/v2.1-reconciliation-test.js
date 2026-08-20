'use strict';

const assert = require('node:assert/strict');
const {
  classifyReconciliation,
  assertRecoveryOwnership,
  calculateBackoffMs,
  shouldReconcile,
} = require('../src/v2.1/reconciliation');

function run() {
  assert.deepEqual(classifyReconciliation({ delivery: 'CONFIRMED', attempt: 1 }), {
    action: 'CONFIRM', nextDeliveryState: 'CONFIRMED',
  });
  assert.deepEqual(classifyReconciliation({ delivery: 'NOT_FOUND', attempt: 1, maxAttempts: 3 }), {
    action: 'SAFE_RETRY', nextDeliveryState: 'NOT_SENT',
  });
  assert.deepEqual(classifyReconciliation({ delivery: 'NOT_FOUND', attempt: 3, maxAttempts: 3 }), {
    action: 'FAIL', nextDeliveryState: 'UNKNOWN',
  });
  assert.deepEqual(classifyReconciliation({ delivery: 'UNKNOWN', attempt: 2 }), {
    action: 'DEFER', nextDeliveryState: 'UNKNOWN',
  });

  const now = new Date('2026-08-20T20:00:00.000Z');
  const validLease = new Date('2026-08-20T20:02:00.000Z');
  const expiredLease = new Date('2026-08-20T19:59:59.000Z');

  assert.equal(assertRecoveryOwnership({ action: 'SAFE_RETRY', workerId: 'worker-a', leaseExpiresAt: validLease, now }), true);
  assert.equal(assertRecoveryOwnership({ action: 'CONFIRM', workerId: 'worker-a', leaseExpiresAt: validLease, now }), true);
  assert.throws(() => assertRecoveryOwnership({ action: 'SAFE_RETRY', workerId: 'worker-a', leaseExpiresAt: expiredLease, now }), /valid, unexpired worker lease/);
  assert.throws(() => assertRecoveryOwnership({ action: 'SAFE_RETRY', workerId: 'worker-a', leaseExpiresAt: now, now }), /valid, unexpired worker lease/);
  assert.throws(() => assertRecoveryOwnership({ action: 'CONFIRM', workerId: '', leaseExpiresAt: validLease, now }), /current worker ownership/);
  assert.throws(() => assertRecoveryOwnership({ action: 'CONFIRM', workerId: null, leaseExpiresAt: validLease, now }), /current worker ownership/);
  assert.equal(assertRecoveryOwnership({ action: 'DEFER', workerId: null, leaseExpiresAt: expiredLease, now }), true);

  assert.equal(calculateBackoffMs(1), 1000);
  assert.equal(calculateBackoffMs(2), 2000);
  assert.equal(calculateBackoffMs(10), 300000);

  assert.equal(shouldReconcile({ deliveryState: 'UNKNOWN', executionStatus: 'EXECUTING' }), true);
  assert.equal(shouldReconcile({ deliveryState: 'NOT_SENT', executionStatus: 'PENDING' }), false);

  assert.throws(() => classifyReconciliation({ delivery: 'NOT_FOUND', attempt: 0 }), /positive integer/);
  assert.throws(() => classifyReconciliation({ delivery: 'BOGUS', attempt: 1 }), /Unsupported reconciliation result/);

  console.log('V2.1 reconciliation recovery certification: PASS');
}

run();
