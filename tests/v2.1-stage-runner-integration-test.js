'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { assertProviderResult } = require('../src/providers/provider-contract');
const { StageRunner } = require('../worker/v2.1-stage-runner');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-stage-runner-'));
  const calls = [];
  try {
    const fakeNvidia = {
      provider: 'nvidia',
      model: 'nvidia/test-model',
      supports({ capability }) { return capability === 'text-generation'; },
      async generate({ prompt, model }) {
        calls.push({ type: 'provider', prompt });
        return assertProviderResult({
          provider: 'nvidia', model: model || this.model,
          output: `generated:${prompt}`, requestId: 'stage-runner-test', usage: { total_tokens: 4 },
        });
      },
    };

    const gateway = new ProviderGateway({ providers: { nvidia: fakeNvidia }, priorities: { nvidia: 10 } });
    const storage = new FilesystemStorageAdapter({ root });
    const artifacts = new ArtifactService({ storage });
    const completed = [];
    const failed = [];

    const execution = {
      async completeStage(client, payload) { completed.push(payload); return { ...payload, status: 'COMPLETED' }; },
      async failStage(client, payload) { failed.push(payload); },
    };

    const runner = new StageRunner({
      execution,
      providerGateway: gateway,
      artifactService: artifacts,
      handlers: {
        SCRIPT: async ({ providerGateway }) => {
          const result = await providerGateway.generate({ capability: 'text-generation', prompt: 'build V2.1 script' });
          return {
            artifacts: [{ artifactId: 'stage-runner-script', type: 'text', content: result.output, provider: result.provider, model: result.model }],
            provenance: result.provenance,
          };
        },
      },
    });

    const result = await runner.run({
      client: {},
      workerId: 'worker-test',
      stageRun: { id: 'stage-run-1', stage: 'SCRIPT', attempt: 1, input_artifacts: [] },
    });

    assert.equal(calls.length, 1);
    assert.equal(completed.length, 1);
    assert.equal(failed.length, 0);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.outputArtifacts.length, 1);

    const stored = await storage.get({ key: result.outputArtifacts[0] });
    assert.equal(stored.toString('utf8'), 'generated:build V2.1 script');
    assert.match(result.outputFingerprint, /^[a-f0-9]{64}$/);

    console.log('V2.1 execution → stage runner → provider → artifact → storage: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
