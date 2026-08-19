'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { assertProviderResult } = require('../src/providers/provider-contract');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v2-'));
  try {
    const fakeNvidia = {
      provider: 'nvidia',
      model: 'nvidia/test-model',
      async generate({ prompt }) {
        return assertProviderResult({
          provider: 'nvidia',
          model: this.model,
          output: `generated:${prompt}`,
          requestId: 'test-request-1',
          usage: { total_tokens: 3 },
        });
      },
    };

    const gateway = new ProviderGateway({ providers: { nvidia: fakeNvidia } });
    const storage = new FilesystemStorageAdapter({ root });
    const artifacts = new ArtifactService({ storage });

    const result = await gateway.generate({ provider: 'nvidia', prompt: 'hello V2' });
    assert.equal(result.provider, 'nvidia');
    assert.equal(result.model, 'nvidia/test-model');

    const artifact = await artifacts.createVersion({
      artifactId: 'integration-test-artifact',
      type: 'text',
      content: result.output,
      stageId: 'stage-test',
      attemptId: 'attempt-test',
      provider: result.provider,
      model: result.model,
    });

    assert.equal(artifact.version, 1);
    assert.equal(artifact.provenance.provider, 'nvidia');
    assert.equal(artifact.provenance.model, 'nvidia/test-model');
    assert.match(artifact.contentHash, /^[a-f0-9]{64}$/);

    const stored = await storage.get({ key: artifact.storageKey });
    assert.equal(stored, result.output);

    console.log('V2.1 provider → artifact → storage integration: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
