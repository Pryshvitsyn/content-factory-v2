'use strict';

const { STAGE_ORDER } = require('./v2.1-production-contract');
const { StageRunner } = require('./v2.1-stage-runner');
const {
  parseJsonOutput,
  validateShape,
  toJsonArtifact,
  buildStructuredPrompt,
} = require('./v2.1-structured-production');

const PLANNING_STAGES = Object.freeze(STAGE_ORDER.slice(0, 8));
const STRUCTURED_STAGES = new Set(['SCRIPT', 'SHOT_PLAN', 'ASSET_PLAN']);

function requireValue(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

function buildPlanningPrompt({ stage, production, inputContents }) {
  if (STRUCTURED_STAGES.has(stage)) return buildStructuredPrompt({ stage, production, inputContents });
  const instructions = {
    SIGNAL: 'Turn the production request into a concise, structured signal describing the audience, objective, constraints and desired outcome.',
    IDEA: 'Develop one strong content idea from the signal. Preserve the production objective and constraints.',
    BRIEF: 'Convert the idea into a production brief with audience, message, tone, deliverable, duration and success criteria.',
    BIBLE: 'Create a production bible covering characters, world, visual identity, tone, continuity rules and non-negotiable constraints.',
    CONCEPT: 'Create the creative concept and narrative direction that the script can faithfully execute.',
  };
  const previous = inputContents.length
    ? `\nPrevious approved stage outputs:\n${inputContents.map((value, index) => `--- ${index + 1} ---\n${value}`).join('\n')}`
    : '';
  return `${instructions[stage]}\n\nProduction request:\n${JSON.stringify(production)}${previous}\n\nReturn only the useful production content. Do not invent facts that contradict earlier approved outputs.`;
}

function validateStructuredConsistency(stage, value, inputContents) {
  validateShape(stage, value);
  if (stage === 'SHOT_PLAN' && inputContents.length) {
    const script = parseJsonOutput('SCRIPT input', inputContents[0]);
    const sceneNumbers = new Set((script.scenes || []).map((scene) => String(scene.scene_number)));
    for (const shot of value.shots) {
      if (shot.scene_id !== undefined && !sceneNumbers.has(String(shot.scene_id))) {
        throw new Error(`SHOT_PLAN references unknown scene_id: ${shot.scene_id}`);
      }
    }
  }
  if (stage === 'ASSET_PLAN' && inputContents.length) {
    const shotPlan = parseJsonOutput('SHOT_PLAN input', inputContents[0]);
    const shotIds = new Set((shotPlan.shots || []).map((shot) => String(shot.shot_id)));
    for (const asset of value.assets) {
      for (const shotId of asset.required_for_shots) {
        if (!shotIds.has(String(shotId))) throw new Error(`ASSET_PLAN references unknown shot_id: ${shotId}`);
      }
    }
  }
  return value;
}

function createPlanningHandlers({ production, providerGateway }) {
  return Object.fromEntries(PLANNING_STAGES.map((stage) => [stage, async ({ stageRun, inputContents }) => {
    const response = await providerGateway.generate({
      capability: 'text-generation',
      routeKey: 'production-planning',
      idempotencyKey: `${stageRun.job_id}:${stage}:attempt-${stageRun.attempt}`,
      system: 'You are a production planning specialist inside a deterministic content factory. Earlier stage outputs are authoritative.',
      prompt: buildPlanningPrompt({ stage, production, inputContents }),
      temperature: 0.2,
      maxTokens: STRUCTURED_STAGES.has(stage) ? 6000 : 4000,
    });
    const content = response.output;
    if (typeof content !== 'string' || content.trim() === '') throw new Error(`${stage} provider returned empty content`);

    if (STRUCTURED_STAGES.has(stage)) {
      const value = validateStructuredConsistency(stage, parseJsonOutput(stage, content), inputContents);
      return {
        artifacts: [toJsonArtifact({ stage, value, stageRun, response })],
        output: value,
        provenance: response.provenance || {},
      };
    }

    return {
      artifacts: [{
        artifactId: `${stageRun.job_id}:${stage}`,
        type: 'text',
        content,
        provider: response.provenance?.provider || response.provider,
        model: response.provenance?.model || response.model,
        idempotencyKey: `${stageRun.job_id}:${stage}:artifact:${stageRun.attempt}`,
      }],
      output: content,
      provenance: response.provenance || {},
    };
  }]));
}

class ProductionOrchestrator {
  constructor({ execution, providerGateway, artifactService, stageRunner } = {}) {
    requireValue('execution', execution);
    requireValue('providerGateway', providerGateway);
    requireValue('artifactService', artifactService);
    this.execution = execution;
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.stageRunner = stageRunner || new StageRunner({ execution, providerGateway, artifactService });
  }

  async createProduction({ client, workspaceId, name, request, workerId, targetStage = 'SCRIPT' } = {}) {
    requireValue('client', client);
    requireValue('workspaceId', workspaceId);
    requireValue('name', name);
    requireValue('workerId', workerId);
    if (!PLANNING_STAGES.includes(targetStage)) throw new Error(`Unsupported planning target: ${targetStage}`);

    const productionResult = await client.query(
      `INSERT INTO v2_1.productions(workspace_id, name, status, metadata) VALUES ($1,$2,'DRAFT',$3::jsonb) RETURNING *`,
      [workspaceId, name, JSON.stringify({ request })],
    );
    const production = productionResult.rows[0];
    const jobResult = await client.query(
      `INSERT INTO v2_1.jobs(production_id, stage, idempotency_key, payload) VALUES ($1,'SIGNAL',$2,$3::jsonb) RETURNING *`,
      [production.id, `production:${production.id}:planning`, JSON.stringify({ request })],
    );
    const job = jobResult.rows[0];

    const handlers = createPlanningHandlers({ production: { id: production.id, name, request }, providerGateway: this.providerGateway });
    for (const [stage, handler] of Object.entries(handlers)) this.stageRunner.register(stage, handler);

    const claimed = await this.execution.claimJobForProduction(client, { jobId: job.id, productionId: production.id, workerId });
    if (!claimed) throw new Error('PRODUCTION_JOB_NOT_CLAIMED');

    const completed = [];
    const targetIndex = STAGE_ORDER.indexOf(targetStage);
    for (let index = 0; index <= targetIndex; index += 1) {
      const stageRun = await this.execution.claimNextStage(client, { jobId: job.id, workerId });
      if (!stageRun) throw new Error(`NO_STAGE_CLAIMED:${STAGE_ORDER[index]}`);
      completed.push(await this.stageRunner.run({ client, stageRun, workerId }));
    }

    return { production, job, completedStages: completed, nextStage: STAGE_ORDER[targetIndex + 1] || null };
  }
}

module.exports = {
  ProductionOrchestrator,
  PLANNING_STAGES,
  STRUCTURED_STAGES,
  buildPlanningPrompt,
  validateStructuredConsistency,
};
