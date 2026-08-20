'use strict';

const RECOVERY_ACTIONS = Object.freeze([
  'CONFIRM',
  'SAFE_RETRY',
  'DEFER',
  'FAIL',
]);

const DEFAULT_MAX_ATTEMPTS = 5;

function assertAttempt(attempt) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
}

function classifyReconciliation({ delivery, attempt, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  assertAttempt(attempt);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');

  switch (delivery) {
    case 'CONFIRMED':
      return { action: 'CONFIRM', nextDeliveryState: 'CONFIRMED' };
    case 'NOT_FOUND':
      if (attempt >= maxAttempts) return { action: 'FAIL', nextDeliveryState: 'UNKNOWN' };
      return { action: 'SAFE_RETRY', nextDeliveryState: 'NOT_SENT' };
    case 'UNKNOWN':
      return { action: 'DEFER', nextDeliveryState: 'UNKNOWN' };
    default:
      throw new Error(`Unsupported reconciliation result: ${delivery}`);
  }
}

function assertRecoveryOwnership({ action, workerId, leaseExpiresAt, now = new Date() }) {
  if (action === 'DEFER') return true;
  if (typeof workerId !== 'string' || workerId.trim() === '') {
    throw new Error('recovery requires current worker ownership');
  }

  const expiry = leaseExpiresAt instanceof Date ? leaseExpiresAt : new Date(leaseExpiresAt);
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(reference.getTime()) || expiry.getTime() <= reference.getTime()) {
    throw new Error('recovery requires a valid, unexpired worker lease');
  }
  return true;
}

function calculateBackoffMs(attempt, { baseMs = 1000, maxMs = 300000 } = {}) {
  assertAttempt(attempt);
  if (baseMs < 0 || maxMs < 0 || maxMs < baseMs) throw new Error('invalid backoff bounds');
  return Math.min(maxMs, baseMs * (2 ** (attempt - 1)));
}

function shouldReconcile({ deliveryState, executionStatus }) {
  return deliveryState === 'UNKNOWN' || executionStatus === 'RECONCILING';
}

module.exports = {
  RECOVERY_ACTIONS,
  DEFAULT_MAX_ATTEMPTS,
  classifyReconciliation,
  assertRecoveryOwnership,
  calculateBackoffMs,
  shouldReconcile,
};
