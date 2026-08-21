'use strict';

const { STAGE_ORDER } = require('./v2.1-production-contract');

const SPEC = Object.freeze({
  SIGNAL: { input: [], output: ['signal'], mode: 'reasoning', humanGate: false, repairable: false },
  IDEA: { input: ['signal'], output: ['idea'], mode: 'reasoning', humanGate: false, repairable: true },
  BRIEF: { input: ['idea'], output: ['brief'], mode: 'reasoning', humanGate: false, repairable: true },
  RESEARCH: { input: ['brief'], output: ['research'], mode: 'reasoning', humanGate: false, repairable: true },
  BIBLE: { input: ['brief', 'research'], output: ['bible'], mode: 'reasoning', humanGate: false, repairable: true },
  CONCEPT: { input: ['bible'], output: ['concept'], mode: 'reasoning', humanGate: false, repairable: true },
  SCRIPT: { input: ['concept', 'bible'], output: ['script'], mode: 'reasoning', humanGate: false, repairable: true },
  SHOT_PLAN: { input: ['script', 'bible'], output: ['shot_plan'], mode: 'planning', humanGate: false, repairable: true },
  ASSET_PLAN: { input: ['shot_plan', 'bible'], output: ['asset_plan'], mode: 'planning', humanGate: false, repairable: true },
  ASSETS: { input: ['asset_plan', 'shot_plan'], output: ['visual_assets', 'audio_assets'], mode: 'generation', humanGate: false, repairable: true },
  EDIT: { input: ['script', 'shot_plan', 'visual_assets', 'audio_assets'], output: ['timeline'], mode: 'assembly', humanGate: false, repairable: true },
  MASTER: { input: ['timeline', 'visual_assets', 'audio_assets'], output: ['master_video'], mode: 'render', humanGate: false, repairable: true },
  OBJECTIVE_QA: { input: ['master_video', 'script', 'bible'], output: ['qa_report'], mode: 'validation', humanGate: false, repairable: true },
  HUMAN_APPROVAL: { input: ['master_video', 'qa_report'], output: ['approval'], mode: 'human_gate', humanGate: true, repairable: false },
  DELIVERY: { input: ['master_video', 'approval'], output: ['delivery_packages'], mode: 'packaging', humanGate: false, repairable: true },
  DELIVERY_QA: { input: ['delivery_packages', 'master_video'], output: ['delivery_qa_report'], mode: 'validation', humanGate: false, repairable: true },
  PUBLISH: { input: ['delivery_packages', 'delivery_qa_report', 'approval'], output: ['publication_receipts'], mode: 'publication', humanGate: false, repairable: false },
  ANALYZE: { input: ['publication_receipts'], output: ['analytics'], mode: 'analysis', humanGate: false, repairable: false },
  LEARN: { input: ['analytics', 'qa_report'], output: ['learning_record'], mode: 'learning', humanGate: false, repairable: false },
});

function assertComplete() {
  const names = Object.keys(SPEC);
  if (names.length !== STAGE_ORDER.length) throw new Error('V2.2 stage spec count drift');
  STAGE_ORDER.forEach((stage) => {
    if (!SPEC[stage]) throw new Error(`Missing V2.2 stage spec: ${stage}`);
    if (!Array.isArray(SPEC[stage].input) || !Array.isArray(SPEC[stage].output)) throw new Error(`Invalid stage spec: ${stage}`);
  });
  return true;
}

function getStageSpec(stage) {
  assertComplete();
  if (!SPEC[stage]) throw new Error(`Unknown stage: ${stage}`);
  return SPEC[stage];
}

function getPipelineSpec() {
  assertComplete();
  return STAGE_ORDER.map((stage, index) => ({
    stage,
    sequence: index + 1,
    ...SPEC[stage],
  }));
}

function canAutoRepair(stage) {
  return getStageSpec(stage).repairable;
}

module.exports = { SPEC, assertComplete, getStageSpec, getPipelineSpec, canAutoRepair };
