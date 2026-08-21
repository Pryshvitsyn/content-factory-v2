'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { StageRunner } = require('../worker/v2.1-stage-runner');

async function run() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v2.1-crash-'));
  let completionAttempts = 0;
  let failAttempts = 0;
  let providerCalls = 0;
  try {
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const artifacts = new ArtifactService({ storage });
    const execution = {
      async completeStage() {
        completionAttempts += 1;
        if (completionAttempts === 1) throw new Error('simulated worker crash after artifact commit');
        return { status: 'COMPLETED' };
      },
      async failStage() { failAttempts += 1; },
    };
    const providerGateway = {
      async generate() {
        providerCalls += 1;
        return { provider: 'nvidia', model: 'nvidia/test-model', output: 'stable-output', provenance: { provider: 'nvidia', model: 'nvidia/test-model' } };
      },
    };
    const runner = new StageRunner({
      execution,
      providerGateway,
      artifactService: artifacts,
      handlers: {
        SIGNAL: async ({ providerGateway: gateway }) => {
          const result = await gateway.generate({});
          return {
            artifacts: [{ artifactId: 'logical-output', type: 'text', content: result.output, provider: result.provider, model: result.model }],
            provenance: result.provenance,
          };
        },
      },
    });

    const base = { job_id: 'job-crash-1', stage: 'SIGNAL', input_artifacts: [] };
    await assert.rejects(() => runner.run({ client: {}, stageRun: { ...base, id: 'run-1' }, workerId: 'worker-a' }), /simulated worker crash/);
    assert.equal(failAttempts, 1);

    const recovered = await runner.run({ client: {}, stageRun: { ...base, id: 'run-2', attempt: 2 }, workerId: 'worker-b' });
    assert.equal(recovered.status, 'COMPLETED');
    assert.equal(providerCalls, 2);
    assert.equal(completionAttempts, 2);
    assert.equal(recovered.outputArtifacts.length, 1);

    const key = recovered.outputArtifacts[0];
    const stored = await storage.get({ key });
    assert.equal(stored.toString('utf8'), 'stable-output');

    const files = fs.readdirSync(path.dirname(path.join(storageRoot, key)));
    assert.equal(files.length, 1, 'crash recovery must leave one logical artifact');
    console.log('V2.1 crash consistency and artifact idempotency: PASS');
  } finally {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
