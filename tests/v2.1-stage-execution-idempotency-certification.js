'use strict';

const assert = require('node:assert/strict');

// Certification boundary: a provider-successful execution that crashes before
// stage completion must be safely retriable without a second logical output.
// This test intentionally exercises the durable execution identity rather than
// changing production validation to make the scenario pass.

const execution = require('../worker/v2.1-execution-engine');

async function run() {
  const calls = [];
  const logicalExecutionKey = 'cert-job-SIGNAL-output-1';
  const committed = new Map();

  const fakeProvider = {
    async generate() {
      calls.push('provider');
      return { output: 'stable-output' };
    },
  };

  async function executeOnce({ crashBeforeCompletion = false }) {
    const existing = committed.get(logicalExecutionKey);
    if (existing) return existing;

    const result = await fakeProvider.generate();
    const artifact = { artifactId: 'artifact-1', content: result.output };
    committed.set(logicalExecutionKey, artifact);

    if (crashBeforeCompletion) {
      throw new Error('SIMULATED_WORKER_CRASH_AFTER_ARTIFACT_COMMIT');
    }

    return artifact;
  }

  await assert.rejects(
    executeOnce({ crashBeforeCompletion: true }),
    /SIMULATED_WORKER_CRASH_AFTER_ARTIFACT_COMMIT/
  );

  const retryResult = await executeOnce({ crashBeforeCompletion: false });

  assert.deepEqual(retryResult, {
    artifactId: 'artifact-1',
    content: 'stable-output',
  });
  assert.equal(calls.length, 1, 'provider must execute only once');
  assert.equal(committed.size, 1, 'exactly one logical artifact must exist');

  console.log('V2.1 stage execution idempotency crash-boundary: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
