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
