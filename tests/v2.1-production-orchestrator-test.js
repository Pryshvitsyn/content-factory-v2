'use strict';

const assert = require('node:assert/strict');
const { ProductionOrchestrator, PLANNING_STAGES, STRUCTURED_STAGES } = require('../worker/v2.1-production-orchestrator');
const { validateShape } = require('../worker/v2.1-structured-production');

async function main() {
  const calls = [];
  const stored = new Map();
  const artifacts = [];
  let stageIndex = 0;
  let previousKey = null;

  const execution = {
    async claimJobForProduction() { return { id: 'job-1', production_id: 'production-1', status: 'RUNNING', worker_id: 'worker-1' }; },
    async claimNextStage() {
      const stage = PLANNING_STAGES[stageIndex++];
      if (!stage) return null;
      return { id: `stage-${stage}`, job_id: 'job-1', stage, attempt: 1, input_artifacts: previousKey ? [previousKey] : [] };
    },
    async completeStage(_client, { stageRunId, outputArtifacts }) {
      previousKey = outputArtifacts[0];
      return { id: stageRunId, status: 'COMPLETED', output_artifacts: outputArtifacts };
    },
    async failStage(_client, args) { throw new Error(`unexpected failStage: ${args.error?.message}`); },
  };

  const structuredOutput = (stage) => ({
    SCRIPT: JSON.stringify({
      title: 'Launch',
      scenes: [{ scene_number: 1, visual: 'Product reveal', duration_seconds: 5, dialogue_or_voiceover: 'Meet the product' }],
    }),
    SHOT_PLAN: JSON.stringify({
      shots: [{ shot_id: 'shot-1', scene_id: '1', duration_seconds: 5, framing: 'wide', camera: 'locked', subject: 'product', action: 'reveal', required_assets: ['product-1'] }],
      continuity: { characters: [], locations: ['studio'], products: ['product-1'], wardrobe: [], props: [], visual_style: 'clean commercial' },
    }),
    ASSET_PLAN: JSON.stringify({
      assets: [{ asset_id: 'product-1', kind: 'product-image', description: 'hero product packshot', source_preference: 'reuse-first', generation_requirements: { background: 'studio' }, required_for_shots: ['shot-1'] }],
    }),
  }[stage]);

  const providerGateway = {
    async generate({ prompt, idempotencyKey }) {
      calls.push({ prompt, idempotencyKey });
      const stage = PLANNING_STAGES[calls.length - 1];
      return { output: STRUCTURED_STAGES.has(stage) ? structuredOutput(stage) : `generated-${calls.length}`, provenance: { provider: 'nvidia', model: 'test-model' } };
    },
  };

  const artifactService = {
    storage: { async get({ key }) { return stored.get(key) || Buffer.from('previous-stage-output'); } },
    async createVersion({ artifactId, content, idempotencyKey, provider, model, type }) {
      const key = `artifacts/${artifactId}`;
      stored.set(key, Buffer.from(String(content)));
      artifacts.push({ artifactId, content, idempotencyKey, provider, model, type, storageKey: key });
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
    targetStage: 'ASSET_PLAN',
  });

  assert.deepEqual(result.completedStages.map((stage) => stage.stage), PLANNING_STAGES);
  assert.equal(calls.length, PLANNING_STAGES.length);
  assert.equal(artifacts.length, PLANNING_STAGES.length);
  assert.equal(result.nextStage, 'ASSETS');
  assert.ok(calls.every((call) => call.idempotencyKey.includes('job-1')));

  const scriptArtifact = artifacts.find((artifact) => artifact.artifactId.endsWith(':SCRIPT'));
  const shotPlanArtifact = artifacts.find((artifact) => artifact.artifactId.endsWith(':SHOT_PLAN'));
  const assetPlanArtifact = artifacts.find((artifact) => artifact.artifactId.endsWith(':ASSET_PLAN'));
  assert.equal(scriptArtifact.type, 'json');
  assert.equal(shotPlanArtifact.type, 'json');
  assert.equal(assetPlanArtifact.type, 'json');
  validateShape('SCRIPT', JSON.parse(scriptArtifact.content));
  validateShape('SHOT_PLAN', JSON.parse(shotPlanArtifact.content));
  validateShape('ASSET_PLAN', JSON.parse(assetPlanArtifact.content));

  assert.throws(() => validateShape('SHOT_PLAN', { shots: [] }), /continuity/);
  console.log('v2.1 structured production planning certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
