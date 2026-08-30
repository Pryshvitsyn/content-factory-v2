'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v2.1-artifact-idempotency-'));
  try {
    const storage = new FilesystemStorageAdapter({ root });
    const artifacts = new ArtifactService({ storage });
    const input = {
      artifactId: 'logical-stage-output',
      type: 'text',
      content: 'stable-output',
      stageId: 'stage-run-1',
      attemptId: 'stage-run-1:1',
      idempotencyKey: 'job-1:SIGNAL:logical-stage-output',
      provider: 'nvidia',
      model: 'nvidia/test-model',
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => artifacts.createVersion(input)));
    assert.equal(new Set(results.map((result) => result.storageKey)).size, 1);
    assert.equal(new Set(results.map((result) => result.contentHash)).size, 1);
    assert.equal(results.filter((result) => result.idempotent).length, 7);
    assert.equal(results.filter((result) => !result.idempotent).length, 1);

    const stored = await storage.get({ key: results[0].storageKey });
    assert.equal(stored.toString('utf8'), 'stable-output');

    const lookup = await artifacts.getVersionByIdempotency({
      artifactId: input.artifactId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
    });
    assert.equal(lookup.idempotent, true);
    assert.equal(lookup.storageKey, results[0].storageKey);
    assert.equal(lookup.content.toString('utf8'), 'stable-output');
    assert.equal(await artifacts.getVersionByIdempotency({
      artifactId: 'missing', type: 'binary', idempotencyKey: 'missing',
    }), null);

    const canonicalJson = {
      artifactId: 'production:test:live-input',
      type: 'text',
      content: JSON.stringify({
        productionKey: 'v210-test',
        script: { hook: 'Notice the moment', scenes: [{ id: 1, copy: 'Do not guess' }] },
        assetPlan: { assets: [{ asset_id: 'video-1', kind: 'video' }] },
      }),
      idempotencyKey: 'brand:production:live-input:canonical-fingerprint',
      provider: 'operator',
      model: 'v2.6-real-content-input',
    };
    const originalJson = await artifacts.createVersion(canonicalJson);
    const reorderedJson = await artifacts.createVersion({ ...canonicalJson, content: JSON.stringify({
      assetPlan: { assets: [{ kind: 'video', asset_id: 'video-1' }] },
      script: { scenes: [{ copy: 'Do not guess', id: 1 }], hook: 'Notice the moment' },
      productionKey: 'v210-test',
    }) });
    assert.equal(reorderedJson.idempotent, true,
      'semantically identical JSON must reuse the immutable artifact even if object key order changed');
    assert.equal(reorderedJson.semanticEquivalent, true);
    assert.equal(reorderedJson.storageKey, originalJson.storageKey);
    assert.equal(reorderedJson.contentHash, originalJson.contentHash,
      'reused artifact must report the hash of the bytes that are actually stored');

    await assert.rejects(
      () => artifacts.createVersion({ ...canonicalJson, content: JSON.stringify({
        productionKey: 'v210-test',
        script: { hook: 'Materially changed', scenes: [{ id: 1, copy: 'Do not guess' }] },
        assetPlan: { assets: [{ asset_id: 'video-1', kind: 'video' }] },
      }) }),
      (error) => error.code === 'ARTIFACT_IDEMPOTENCY_CONFLICT'
        && error.details?.artifactId === canonicalJson.artifactId
        && error.details?.existingHash
        && error.details?.incomingHash,
      'materially different JSON must remain a hard idempotency conflict with durable diagnostics'
    );

    await assert.rejects(
      () => artifacts.createVersion({ ...input, content: 'tampered-output' }),
      /Artifact idempotency conflict: existing content differs/
    );

    console.log('V2.1 artifact idempotency/concurrency certification: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
