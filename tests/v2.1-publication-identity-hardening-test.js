'use strict';

const assert = require('node:assert/strict');
const {
  canonicalPublicationIdentity,
  publicationIdentity,
  createPublicationIntent,
} = require('../src/v2.1/publication-domain');

function run() {
  const canonical = canonicalPublicationIdentity({ artifactVersionId: 'av-17', destination: 'youtube:brand-main' });
  assert.equal(canonical, 'av-17:youtube:brand-main');
  assert.equal(publicationIdentity({ artifactVersionId: 'av-17', destination: 'youtube:brand-main' }), canonical);
  assert.equal(publicationIdentity({ artifactVersionId: 'av-17', destination: 'youtube:brand-main', idempotencyKey: canonical }), canonical);

  assert.notEqual(canonicalPublicationIdentity({ artifactVersionId: 'av-18', destination: 'youtube:brand-main' }), canonical);
  assert.notEqual(canonicalPublicationIdentity({ artifactVersionId: 'av-17', destination: 'instagram:brand-main' }), canonical);

  assert.throws(
    () => publicationIdentity({ artifactVersionId: 'av-17', destination: 'youtube:brand-main', idempotencyKey: 'forged-key' }),
    /must match canonical publication identity/
  );

  assert.equal(
    createPublicationIntent({ artifactVersionId: 'av-17', destination: 'youtube:brand-main', idempotencyKey: canonical }).idempotencyKey,
    canonical
  );

  console.log('V2.1 canonical publication identity certification: PASS');
}

run();
