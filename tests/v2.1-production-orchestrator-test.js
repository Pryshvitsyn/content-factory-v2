'use strict';

const assert = require('node:assert/strict');
const { ProductionOrchestrator, PLANNING_STAGES } = require('../worker/v2.1-production-orchestrator');

async function main() {
  const calls = [];
  const stored = new Map();
  const artifacts = [];
  let stageIndex = 0;
  let sequence = 0;

  const execution = {
    async claimJobForProduction() { return { id: 'job-1', production_id: 'production-1', status: 'RUNNING', worker_id: 'worker-1' }; },
    async claimNextStage() {
      const stage = PLANNING_STAGES[stageIndex++];
      if (!stage) return null;
      return { id: `stage-${stage}`, job_id: 'job-1', stage, attempt: 1, input_artifacts: sequence ? [`artifacts/${PLANNING_STAGES[sequence - 1]}-${sequence}`] : [] };
    },
    async completeStage(_client, { stageRunId, outputArtifacts }) {
      sequence += 1;
      return { id: stageRunId, status: 'COMPLETED', output_artifacts: outputArtifacts };
    },
    async failStage(_client, args) { throw new Error(`unexpected failStage: ${args.error?.message}`); },
  };

  const providerGateway = {
    async generate({ prompt, idempotencyKey }) {
      calls.push({ prompt, idempotencyKey });
      return { output: `generated-${calls.length}`, provenance: { provider: 'nvidia', model: 'test-model' } };
    },
  };

  const artifactService = {
    storage: { async get({ key }) { return stored.get(key) || Buffer.from('previous-stage-output'); } },
    async createVersion({ artifactId, content, idempotencyKey, provider, model }) {
      const key = `artifacts/${artifactId}`;
      stored.set(key, Buffer.from(String(content)));
      artifacts.push({ artifactId, content, idempotencyKey, provider, model, storageKey: key });
      return { storageKey: key };
    },
  };

  const client = { query: async (sql) => {
    if (sql.includes('INSERT INTO v2_1.productions')) return { rows: [{ id: 'production-1', name: 'certification-production', status: 'DRAFT' }] };
    if (sql.includes('INSERT INTO v2_1.jobs')) return { rows: [{ id: 'job-1', production_id: 'production-1', status: 'QUEUED' }] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };

  const orchestrator = new ProductionOrchestrator({ execution, providerGateway, artifactService });
  const result = await orchestrator.createProduction({
    client,
    workspaceId: 'workspace-1',
    name: 'certification-production',
    request: { objective: 'Create a 30-second product launch video', audience: 'customers', language: 'English' },
    workerId: 'worker-1',
    targetStage: 'SCRIPT',
  });

  assert.deepEqual(result.completedStages.map((stage) => stage.stage), PLANNING_STAGES);
  assert.equal(calls.length, 6);
  assert.equal(artifacts.length, 6);
  assert.equal(result.nextStage, 'SHOT_PLAN');
  assert.match(calls.at(-1).prompt, /generated-5/);
  assert.ok(calls.every((call) => call.idempotencyKey.includes('job-1')));
  console.log('v2.1 production orchestrator certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
