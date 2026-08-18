'use strict';

/**
 * Canonical V2.1 production contract.
 *
 * This module is intentionally dependency-free. Database migrations and the
 * execution engine must agree with these names and ordering.
 */

const STAGE_ORDER = [
  'SIGNAL',
  'IDEA',
  'BRIEF',
  'BIBLE',
  'CONCEPT',
  'SCRIPT',
  'SHOT_PLAN',
  'ASSET_PLAN',
  'ASSETS',
  'EDIT',
  'PLATFORM_ADAPTATION',
  'VALIDATION',
  'PUBLISH',
  'ANALYZE',
  'LEARN',
];

const TERMINAL_STAGE = 'LEARN';

const STAGE_DEFINITIONS = Object.freeze(Object.fromEntries(
  STAGE_ORDER.map((stage, index) => [stage, Object.freeze({
    stage,
    order: index + 1,
    terminal: stage === TERMINAL_STAGE,
    retryable: true,
    requiresPreviousStage: index > 0,
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

module.exports = {
  STAGE_ORDER: Object.freeze([...STAGE_ORDER]),
  STAGE_DEFINITIONS,
  TERMINAL_STAGE,
  getStageDefinition,
  isValidStage,
  isTerminalStage,
  nextStage,
  previousStage,
  stageIndex,
  assertStageTransition,
};
