'use strict';

const assert = require('node:assert/strict');
const {
  canTransition,
  assertTransition,
  createPublicationIntent,
  publicationIdentity,
} = require('../src/v2.1/publication-domain');

function run() {
  const intent = createPublicationIntent({
    artifactVersionId: 'artifact-v17',
    destination: 'youtube:brand-main',
    platform: 'youtube',
    accountId: 'brand-main',
    correlationId: 'corr-1',
  });

  assert.equal(intent.executionStatus, 'PENDING');
  assert.equal(intent.deliveryState, 'NOT_SENT');
  assert.equal(intent.idempotencyKey, 'artifact-v17:youtube:brand-main');
  assert.equal(publicationIdentity({ artifactVersionId: 'artifact-v17', destination: 'youtube:brand-main' }), intent.idempotencyKey);

  assert.equal(canTransition('PENDING', 'CLAIMED'), true);
  assert.equal(canTransition('EXECUTING', 'RECONCILING'), true);
  assert.equal(canTransition('RECONCILING', 'EXECUTING'), true);
  assert.equal(canTransition('SUCCEEDED', 'EXECUTING'), false);
  assert.equal(canTransition('CANCELLED', 'CLAIMED'), false);

  assertTransition('PENDING', 'CLAIMED');
  assert.throws(() => assertTransition('SUCCEEDED', 'EXECUTING'), /Invalid publication transition/);

  console.log('V2.1 publication domain certification: PASS');
}

run();
