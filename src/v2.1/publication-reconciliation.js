'use strict';

const CONFIRMED = 'CONFIRMED';
const NOT_FOUND = 'NOT_FOUND';
const UNKNOWN = 'UNKNOWN';
const SAFE_RETRY = 'SAFE_RETRY';
const DEFER = 'DEFER';
const FAIL = 'FAIL';

function classify({ status, attempt, maxAttempts }) {
  if (status === CONFIRMED) return { action: CONFIRMED, terminal: true };
  if (status === NOT_FOUND) {
    if (attempt < maxAttempts) return { action: SAFE_RETRY, terminal: false };
    return { action: FAIL, terminal: true };
  }
  if (status === UNKNOWN) return { action: DEFER, terminal: false };
  throw new Error(`Unsupported reconciliation status: ${status}`);
}

function assertMutationOwnership({ workerId, leaseExpiresAt, now = new Date() }) {
  if (!workerId) throw new Error('workerId is required');
  if (!leaseExpiresAt || new Date(leaseExpiresAt).getTime() <= new Date(now).getTime()) {
    const error = new Error('WORKER_LEASE_EXPIRED');
    error.code = 'WORKER_LEASE_EXPIRED';
    throw error;
  }
}

function backoffMs({ attempt, baseMs = 1000, maxMs = 60000 }) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

module.exports = { classify, assertMutationOwnership, backoffMs, CONFIRMED, NOT_FOUND, UNKNOWN, SAFE_RETRY, DEFER, FAIL };
