'use strict';

/**
 * Canonical V2.1 production contract.
 *
 * Stages describe execution checkpoints. The production graph remains the
 * dependency authority; this ordered contract defines the lifecycle gates.
 * Human approval is an explicit gate and is never inferred from QA success.
 */

const STAGE_ORDER = [
  'SIGNAL',
  'IDEA',
  'BRIEF',
  'RESEARCH',
  'BIBLE',
  'CONCEPT',
  'SCRIPT',
  'SHOT_PLAN',
  'ASSET_PLAN',
  'ASSETS',
  'EDIT',
  'MASTER',
  'OBJECTIVE_QA',
  'HUMAN_APPROVAL',
  'DELIVERY',
  'DELIVERY_QA',
  'PUBLISH',
  'ANALYZE',
  'LEARN',
];

const TERMINAL_STAGE = 'LEARN';

const NON_AUTONOMOUS_GATES = new Set(['HUMAN_APPROVAL']);
const REPAIR_AUTHORIZED_STAGES = new Set(['OBJECTIVE_QA', 'DELIVERY_QA']);

const STAGE_DEFINITIONS = Object.freeze(Object.fromEntries(
  STAGE_ORDER.map((stage, index) => [stage, Object.freeze({
    stage,
    order: index + 1,
    terminal: stage === TERMINAL_STAGE,
    retryable: !NON_AUTONOMOUS_GATES.has(stage),
    requiresPreviousStage: index > 0,
    humanGate: NON_AUTONOMOUS_GATES.has(stage),
    mayAuthorizeAutomaticRepair: REPAIR_AUTHORIZED_STAGES.has(stage),
  })])
));

function getStageDefinition(stage) {
  if (!STAGE_DEFINITIONS[stage]) throw new Error(`Unknown V2.1 stage: ${stage}`);
  return STAGE_DEFINITIONS[stage];
}

function isValidStage(stage) {
  return typeof stage === 'string' && Object.prototype.hasOwnProperty.call(STAGE_DEFINITIONS, stage);
}

function isTerminalStage(stage) {
  return stage === TERMINAL_STAGE;
}

function nextStage(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) throw new Error(`Unknown V2.1 stage: ${stage}`);
  return STAGE_ORDER[index + 1] || null;
}

function previousStage(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) throw new Error(`Unknown V2.1 stage: ${stage}`);
  return index > 0 ? STAGE_ORDER[index - 1] : null;
}

function stageIndex(stage) {
  return getStageDefinition(stage).order;
}

function assertStageTransition(fromStage, toStage) {
  if (toStage !== nextStage(fromStage)) {
    throw new Error(`Invalid V2.1 stage transition: ${fromStage} -> ${toStage}`);
  }
  return true;
}

function assertAutomaticRepairAuthorized(stage, finding) {
  if (!REPAIR_AUTHORIZED_STAGES.has(stage)) {
    throw new Error(`Automatic repair is not authorized from stage: ${stage}`);
  }
  if (!finding || finding.kind !== 'objective_rule_violation') {
    throw new Error('Automatic repair requires an objective_rule_violation finding');
  }
  return true;
}

module.exports = {
  STAGE_ORDER: Object.freeze([...STAGE_ORDER]),
  STAGE_DEFINITIONS,
  TERMINAL_STAGE,
  NON_AUTONOMOUS_GATES: Object.freeze([...NON_AUTONOMOUS_GATES]),
  REPAIR_AUTHORIZED_STAGES: Object.freeze([...REPAIR_AUTHORIZED_STAGES]),
  getStageDefinition,
  isValidStage,
  isTerminalStage,
  nextStage,
  previousStage,
  stageIndex,
  assertStageTransition,
  assertAutomaticRepairAuthorized,
};
