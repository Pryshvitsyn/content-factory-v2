'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  durableSemanticEvaluation,
  materializeEvaluationFrames,
} = require('../src/v2.9/semantic-evaluation-retry');

async function main() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const contentHash = crypto.createHash('sha256').update(jpeg).digest('hex');
  const descriptor = {
    ratio: 0.5,
    timestampMs: 2500,
    analysisHash: 'analysis-hash-1',
    artifactId: 'brand:b:asset:operator-video-1:quality:source:frame:1',
    artifactVersion: 1,
    storageKey: 'artifacts/frame-1.bin',
    contentHash,
    contentType: 'image/jpeg',
  };

  // Exact legacy shape after a Buffer has gone through JSONB/JSON round-trip.
  const legacyEvaluation = {
    status: 'PASS',
    semantic: { status: 'PASS', checks: [{ status: 'PASS' }] },
    sampledFrames: [{
      ...descriptor,
      bytes: { type: 'Buffer', data: [1, 2, 3] },
      jpeg: { type: 'Buffer', data: [4, 5, 6] },
    }],
  };

  const durable = durableSemanticEvaluation(legacyEvaluation);
  assert.equal(durable.sampledFrames.length, 1);
  assert.equal(durable.sampledFrames[0].storageKey, descriptor.storageKey);
  assert.equal(durable.sampledFrames[0].contentHash, descriptor.contentHash);
  assert.equal('bytes' in durable.sampledFrames[0], false);
  assert.equal('jpeg' in durable.sampledFrames[0], false);
  assert.doesNotMatch(JSON.stringify(durable), /\"type\":\"Buffer\"/);

  let storageReads = 0;
  const materialized = await materializeEvaluationFrames({
    get: async ({ key }) => {
      storageReads += 1;
      assert.equal(key, descriptor.storageKey);
      return jpeg;
    },
  }, legacyEvaluation);

  assert.equal(storageReads, 1);
  assert.equal(Buffer.isBuffer(materialized.sampledFrames[0].bytes), true);
  assert.equal(Buffer.isBuffer(materialized.sampledFrames[0].jpeg), true);
  assert.deepEqual(materialized.sampledFrames[0].jpeg, jpeg);
  assert.equal(materialized.sampledFrames[0].contentHash, contentHash);

  await assert.rejects(() => materializeEvaluationFrames({
    get: async () => Buffer.from('tampered'),
  }, legacyEvaluation), (error) => error.code === 'SEMANTIC_RETRY_FRAME_HASH_MISMATCH');

  console.log('V2.9.2.4 semantic recovery evidence JSON-round-trip regression passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
