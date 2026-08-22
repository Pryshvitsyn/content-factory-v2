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
const { STAGE_ORDER } = require('../worker/v2.1-production-contract');
const { fingerprint } = require('../worker/v2.1-execution-engine');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v2.1-multi-stage-'));
  const completed = [];
  const failed = [];
  const calls = [];

  try {
    const provider = {
      provider: 'nvidia',
      model: 'nvidia/test-model',
      supports({ capability }) { return capability === 'text_generation'; },
      async generate({ prompt, model }) {
        calls.push(prompt);
        return assertProviderResult({
          provider: 'nvidia',
          model: model || this.model,
          output: `generated:${prompt}`,
          requestId: `multi-stage-${calls.length}`,
          usage: { total_tokens: 4 },
        });
      },
    };

    const gateway = new ProviderGateway({ providers: { nvidia: provider }, priorities: { nvidia: 10 } });
    const storage = new FilesystemStorageAdapter({ root });
    const artifacts = new ArtifactService({ storage });

    const execution = {
      async completeStage(client, payload) {
        completed.push(payload);
        return { ...payload, status: 'COMPLETED' };
      },
      async failStage(client, payload) {
        failed.push(payload);
      },
    };

    const handlers = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, async ({ providerGateway, inputArtifacts }) => {
      const previous = inputArtifacts.length ? inputArtifacts.join(',') : 'ROOT';
      const result = await providerGateway.generate({
        capability: 'text_generation',
        prompt: `${stage}|input=${previous}`,
      });
      return {
        artifacts: [{
          artifactId: `pipeline-${stage.toLowerCase()}`,
          type: 'text',
          content: result.output,
          provider: result.provider,
          model: result.model,
        }],
        provenance: result.provenance,
      };
    }]));

    const runner = new StageRunner({ execution, providerGateway: gateway, artifactService: artifacts, handlers });
    let inputArtifacts = [];

    for (let index = 0; index < STAGE_ORDER.length; index += 1) {
      const stage = STAGE_ORDER[index];
      const inputFingerprint = fingerprint(inputArtifacts);
      const result = await runner.run({
        client: {},
        workerId: 'multi-stage-worker',
        stageRun: {
          id: `stage-run-${index + 1}`,
          stage,
          attempt: 1,
          input_artifacts: inputArtifacts,
          input_fingerprint: inputFingerprint,
        },
      });

      assert.equal(result.status, 'COMPLETED');
      assert.equal(result.outputArtifacts.length, 1);
      assert.match(result.outputFingerprint, /^[a-f0-9]{64}$/);

      const stored = await storage.get({ key: result.outputArtifacts[0] });
      assert.match(stored.toString('utf8'), new RegExp(`^generated:${stage}\\|input=`));
      inputArtifacts = result.outputArtifacts;
    }

    assert.equal(calls.length, STAGE_ORDER.length);
    assert.equal(completed.length, STAGE_ORDER.length);
    assert.equal(failed.length, 0);
    assert.equal(completed.at(-1).stageRunId, `stage-run-${STAGE_ORDER.length}`);

    const beforeMismatchCalls = calls.length;
    await assert.rejects(
      runner.run({
        client: {},
        workerId: 'multi-stage-worker',
        stageRun: {
          id: 'stage-run-fingerprint-mismatch',
          stage: STAGE_ORDER[0],
          attempt: 1,
          input_artifacts: inputArtifacts,
          input_fingerprint: fingerprint(['tampered-input']),
        },
      }),
      (error) => error.code === 'STAGE_INPUT_FINGERPRINT_MISMATCH'
    );
    assert.equal(calls.length, beforeMismatchCalls);
    assert.equal(failed.at(-1).error.code, 'STAGE_INPUT_FINGERPRINT_MISMATCH');

    console.log(`V2.1 full multi-stage runtime (${STAGE_ORDER.length} stages) + input integrity: PASS`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
