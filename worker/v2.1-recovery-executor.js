'use strict';

const {
  classifyReconciliation,
  assertRecoveryOwnership,
  shouldReconcile,
} = require('../src/v2.1/reconciliation');

function requireDependency(name, value) {
  if (!value || typeof value !== 'function') throw new Error(`${name} function is required`);
}

class RecoveryExecutor {
  constructor({ reconcile, confirm, safeRetry, defer, fail, clock = () => new Date() } = {}) {
    requireDependency('reconcile', reconcile);
    requireDependency('confirm', confirm);
    requireDependency('safeRetry', safeRetry);
    requireDependency('defer', defer);
    requireDependency('fail', fail);
    requireDependency('clock', clock);
    this.reconcile = reconcile;
    this.confirm = confirm;
    this.safeRetry = safeRetry;
    this.defer = defer;
    this.fail = fail;
    this.clock = clock;
  }

  async run({ publication, workerId, leaseExpiresAt, now } = {}) {
    if (!publication?.id) throw new Error('publication.id is required');
    if (!shouldReconcile(publication)) return { action: 'NOOP', publicationId: publication.id };

    const initialNow = now ?? this.clock();
    assertRecoveryOwnership({
      action: 'RECONCILE',
      workerId,
      leaseExpiresAt,
      now: initialNow,
    });

    const result = await this.reconcile(publication);
    const decision = classifyReconciliation({
      delivery: result.delivery,
      attempt: publication.attempt,
      maxAttempts: publication.maxAttempts,
    });

    if (decision.action === 'DEFER') {
      await this.defer(publication, result);
      return { action: 'DEFER', publicationId: publication.id };
    }

    assertRecoveryOwnership({
      action: decision.action,
      workerId,
      leaseExpiresAt,
      now: this.clock(),
    });

    if (decision.action === 'CONFIRM') {
      await this.confirm(publication, result);
    } else if (decision.action === 'SAFE_RETRY') {
      await this.safeRetry(publication, result);
    } else if (decision.action === 'FAIL') {
      await this.fail(publication, result);
    }

    return { action: decision.action, publicationId: publication.id };
  }
}

module.exports = { RecoveryExecutor };
