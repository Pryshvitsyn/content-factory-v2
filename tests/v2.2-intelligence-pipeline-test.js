'use strict';

const assert = require('node:assert/strict');
const {
  PLANNING_STAGES,
  STAGE_INPUTS,
  REQUIRED_FIELDS,
  fingerprint,
  validateStageOutput,
  buildPlanningEnvelope,
  executePlanningStage,
} = require('../worker/v2.2-intelligence-pipeline');

function validOutput(stage) {
  const output = {};
  for (const field of REQUIRED_FIELDS[stage]) output[field] = field === 'duration_seconds' ? 30 : [];
  if (stage === 'BRIEF') Object.assign(output, { objective: 'make a useful video', audience: 'general', promise: 'clear value', constraints: [] });
  if (stage === 'BIBLE') Object.assign(output, { tone: 'clear', voice: 'direct', visual_language: 'clean', continuity_rules: [] });
  if (stage === 'CONCEPT') Object.assign(output, { title: 'Test concept', logline: 'A test', hook: 'Why now', structure: [] });
  if (stage === 'SCRIPT') Object.assign(output, { scenes: [], narration: [], duration_seconds: 30 });
  return output;
}

(async () => {
  assert.deepEqual(PLANNING_STAGES, ['BRIEF', 'RESEARCH', 'BIBLE', 'CONCEPT', 'SCRIPT', 'SHOT_PLAN', 'ASSET_PLAN']);
  assert.deepEqual(STAGE_INPUTS.SCRIPT, ['CONCEPT', 'BIBLE']);

  const idea = { idea: 'Explain one useful AI workflow', audience: 'developers' };
  const envelope = buildPlanningEnvelope('BRIEF', { IDEA: idea }, { locale: 'en' });
  assert.equal(envelope.contract_version, '2.2');
  assert.equal(envelope.stage, 'BRIEF');
  assert.equal(envelope.input_fingerprints.IDEA, fingerprint(idea));

  assert.throws(() => buildPlanningEnvelope('SCRIPT', { CONCEPT: {} }), /requires input artifact: BIBLE/);
  assert.throws(() => validateStageOutput('SCRIPT', { scenes: [], narration: [] }), /duration_seconds/);

  const result = await executePlanningStage({
    stage: 'BRIEF',
    inputs: { IDEA: idea },
    reasoner: async (request) => ({
      objective: 'make a useful video',
      audience: 'developers',
      promise: 'clear value',
      constraints: [],
      source_stage: request.stage,
    }),
  });
  assert.equal(result.stage, 'BRIEF');
  assert.ok(result.output_fingerprint);

  await assert.rejects(
    executePlanningStage({ stage: 'BRIEF', inputs: { IDEA: idea }, timeoutMs: 20, reasoner: () => new Promise(() => {}) }),
    /timed out after 20ms/
  );

  const jsonResult = await executePlanningStage({
    stage: 'CONCEPT',
    inputs: { BIBLE: validOutput('BIBLE') },
    reasoner: async () => JSON.stringify(validOutput('CONCEPT')),
  });
  assert.equal(jsonResult.output.title, 'Test concept');

  console.log('V2.2 AI intelligence pipeline contract: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
