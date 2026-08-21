'use strict';

const { classify, assertMutationOwnership, backoffMs } = require('./publication-reconciliation');

async function reconcilePublication({ publication, workerId, leaseExpiresAt, now = new Date(), lookup, confirm, retry, fail, defer }) {
  if (!publication || publication.status !== 'UNKNOWN') throw new Error('publication must be UNKNOWN');
  if (typeof lookup !== 'function') throw new Error('lookup is required');
  const status = await lookup(publication);
  const decision = classify({ status, attempt: publication.attempt, maxAttempts: publication.maxAttempts });

  if (decision.action === 'DEFER') {
    await defer({ publication, backoffMs: backoffMs({ attempt: publication.attempt }) });
    return decision;
  }

  assertMutationOwnership({ workerId, leaseExpiresAt, now });
  if (decision.action === 'CONFIRMED') await confirm({ publication });
  else if (decision.action === 'SAFE_RETRY') await retry({ publication, backoffMs: backoffMs({ attempt: publication.attempt }) });
  else if (decision.action === 'FAIL') await fail({ publication });
  return decision;
}

module.exports = { reconcilePublication };
