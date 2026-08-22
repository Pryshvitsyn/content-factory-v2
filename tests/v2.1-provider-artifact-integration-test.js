'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { assertProviderResult } = require('../src/providers/provider-contract');
const { CAPABILITIES } = require('../src/providers/capability-contract');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v2-'));
  try {
    const fakeNvidia = {
      provider: 'nvidia',
      model: 'nvidia/test-model',
      supports({ capability }) { return capability === CAPABILITIES.TEXT_GENERATION; },
      async generate({ prompt, model }) {
        return assertProviderResult({
          provider: 'nvidia',
          model: model || this.model,
          output: `generated:${prompt}`,
          requestId: 'test-request-1',
          usage: { total_tokens: 3 },
        });
      },
    };

    const gateway = new ProviderGateway({
      providers: { nvidia: fakeNvidia },
      priorities: { nvidia: 10 },
    });
    const storage = new FilesystemStorageAdapter({ root });
    const artifacts = new ArtifactService({ storage });

    const selection = gateway.select({ capability: 'text-generation' });
    assert.deepEqual(selection, {
      provider: 'nvidia',
      model: 'nvidia/test-model',
      selectionReason: 'single-available-provider',
      capability: CAPABILITIES.TEXT_GENERATION,
    });

    const result = await gateway.generate({ capability: 'text-generation', prompt: 'hello V2' });
    assert.equal(result.provider, 'nvidia');
    assert.equal(result.model, 'nvidia/test-model');
    assert.equal(result.provenance.capability, CAPABILITIES.TEXT_GENERATION);
    assert.equal(result.provenance.selectionReason, 'single-available-provider');

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
    assert.equal(stored.toString('utf8'), result.output);
    assert.equal((await storage.head({ key: artifact.storageKey })).size, Buffer.byteLength(result.output));
    assert.equal(await storage.exists({ key: artifact.storageKey }), true);

    const second = await artifacts.createVersion({
      artifactId: 'integration-test-artifact',
      type: 'text',
      content: 'second version',
      stageId: 'stage-test',
      attemptId: 'attempt-test-2',
      provider: result.provider,
      model: result.model,
    });
    assert.equal(second.version, 2);
    assert.notEqual(second.storageKey, artifact.storageKey);

    console.log('V2.1 provider → artifact → storage integration: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
