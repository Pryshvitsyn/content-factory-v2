'use strict';

const assert = require('node:assert/strict');
const { StageRunner } = require('../worker/v2.1-stage-runner');

async function run() {
  const calls = [];
  const createdArtifacts = [];
  let completed = null;
  let failed = null;

  const execution = {
    async completeStage(_client, payload) {
      completed = payload;
      return { id: 'stage-run-1', status: 'COMPLETED' };
    },
    async failStage(_client, payload) {
      failed = payload;
    },
  };

  const providerGateway = {
    async generate(request) {
      calls.push(request);
      return {
        provider: 'nvidia',
        model: 'nvidia/test-model',
        output: `generated:${request.prompt}`,
        provenance: {
          provider: 'nvidia',
          model: 'nvidia/test-model',
          selectionReason: 'single-available-provider',
        },
      };
    },
  };

  const artifactService = {
    async createVersion(artifact) {
      createdArtifacts.push(artifact);
      return { storageKey: 'artifacts/stage-run-1/v1' };
    },
  };

  const runner = new StageRunner({ execution, providerGateway, artifactService });
  runner.register('CONCEPT', async ({ providerGateway: gateway, inputArtifacts }) => {
    const result = await gateway.generate({
      capability: 'text-generation',
      prompt: `build:${inputArtifacts.map(({ artifactId }) => artifactId).join(',')}`,
    });
    return {
      output: result.output,
      provenance: result.provenance,
      artifacts: [{
        artifactId: 'concept-output-1',
        type: 'text',
        content: result.output,
        provider: result.provider,
        model: result.model,
      }],
    };
  });

  const result = await runner.run({
    client: {},
    workerId: 'worker-1',
    stageRun: {
      id: 'stage-run-1',
      stage: 'CONCEPT',
      attempt: 1,
      input_artifacts: [{ artifactId: 'input-1' }],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].capability, 'text-generation');
  assert.equal(calls[0].prompt, 'build:input-1');
  assert.equal(createdArtifacts.length, 1);
  assert.equal(createdArtifacts[0].artifactId, 'concept-output-1');
  assert.equal(createdArtifacts[0].provider, 'nvidia');
  assert.equal(createdArtifacts[0].model, 'nvidia/test-model');
  assert.deepEqual(completed, {
    stageRunId: 'stage-run-1',
    workerId: 'worker-1',
    outputArtifacts: ['artifacts/stage-run-1/v1'],
    outputFingerprint: result.outputFingerprint,
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(failed, null);

  console.log('V2.1 single-stage execution certification: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
