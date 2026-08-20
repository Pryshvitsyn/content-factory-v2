'use strict';

const assert = require('node:assert/strict');
const {
  classifyReconciliation,
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
