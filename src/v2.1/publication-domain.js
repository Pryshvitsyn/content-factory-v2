'use strict';

const EXECUTION_STATUSES = Object.freeze([
  'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
]);

const DELIVERY_STATES = Object.freeze([
  'NOT_SENT', 'SENT', 'CONFIRMED', 'UNKNOWN',
]);

const TERMINAL_EXECUTION = new Set(['SUCCEEDED', 'CANCELLED']);

function assertExecutionStatus(status) {
  if (!EXECUTION_STATUSES.includes(status)) throw new Error(`Invalid execution status: ${status}`);
}

function assertDeliveryState(state) {
  if (!DELIVERY_STATES.includes(state)) throw new Error(`Invalid delivery state: ${state}`);
}

function canTransition(from, to) {
  assertExecutionStatus(from);
  assertExecutionStatus(to);
  if (from === to) return true;
  const transitions = {
    PENDING: new Set(['CLAIMED', 'CANCELLED']),
    CLAIMED: new Set(['EXECUTING', 'FAILED', 'CANCELLED']),
    EXECUTING: new Set(['RECONCILING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
    RECONCILING: new Set(['SUCCEEDED', 'FAILED', 'EXECUTING']),
    FAILED: new Set(['CLAIMED', 'CANCELLED']),
    SUCCEEDED: new Set(),
    CANCELLED: new Set(),
  };
  return transitions[from].has(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid publication transition: ${from} -> ${to}`);
  }
}

function publicationIdentity({ artifactVersionId, destination, idempotencyKey }) {
  if (!artifactVersionId) throw new Error('artifactVersionId is required');
  if (!destination) throw new Error('destination is required');
  return idempotencyKey || `${artifactVersionId}:${destination}`;
}

function createPublicationIntent({ artifactVersionId, destination, idempotencyKey, accountId, platform, channel, scheduledAt, timezone, productionRunId, pipelineRunId, correlationId }) {
  return {
    artifactVersionId,
    destination,
    idempotencyKey: publicationIdentity({ artifactVersionId, destination, idempotencyKey }),
    accountId: accountId || null,
    platform: platform || null,
    channel: channel || null,
    scheduledAt: scheduledAt || null,
    timezone: timezone || null,
    productionRunId: productionRunId || null,
    pipelineRunId: pipelineRunId || null,
    correlationId: correlationId || null,
    executionStatus: 'PENDING',
    deliveryState: 'NOT_SENT',
  };
}

module.exports = {
  EXECUTION_STATUSES,
  DELIVERY_STATES,
  TERMINAL_EXECUTION,
  assertExecutionStatus,
  assertDeliveryState,
  canTransition,
  assertTransition,
  publicationIdentity,
  createPublicationIntent,
};
