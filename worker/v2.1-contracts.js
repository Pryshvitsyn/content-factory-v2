const STAGES = Object.freeze([
  'SIGNAL',
  'IDEA',
  'BRIEF',
  'CONCEPT',
  'SCRIPT',
  'BIBLE',
  'ASSET_PLAN',
  'SHOT_PLAN',
  'ASSET_GENERATION',
  'CONTINUITY',
  'EDIT',
  'PLATFORM_ADAPTATION',
  'VALIDATION',
  'PUBLISH',
  'ANALYZE',
  'LEARN',
]);

const JOB_STATES = Object.freeze(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED']);

const STAGE_TRANSITIONS = Object.freeze({
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  FAILED: ['RETRYING', 'CANCELLED'],
  RETRYING: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

const CAPABILITIES = Object.freeze([
  'TEXT',
  'IMAGE',
  'VIDEO',
  'VOICE',
  'AUDIO',
  'MUSIC',
  'VISION',
  'TRANSCRIPTION',
  'EMBEDDING',
]);

const PLATFORMS = Object.freeze(['TIKTOK', 'INSTAGRAM_REELS', 'YOUTUBE_SHORTS', 'YOUTUBE']);

const ARTIFACT_TYPES = Object.freeze([
  'SCRIPT',
  'PRODUCTION_BIBLE',
  'REFERENCE_IMAGE',
  'IMAGE',
  'VIDEO',
  'VOICE',
  'AUDIO',
  'MUSIC',
  'CAPTIONS',
  'EDIT',
  'FINAL_VIDEO',
  'THUMBNAIL',
]);

function assertKnown(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  }
}

function assertStage(stage) {
  assertKnown(stage, STAGES, 'stage');
}

function assertCapability(capability) {
  assertKnown(capability, CAPABILITIES, 'capability');
}

function canTransition(from, to) {
  assertKnown(from, JOB_STATES, 'from');
  assertKnown(to, JOB_STATES, 'to');
  return STAGE_TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}

function buildIdempotencyKey({ stage, inputHash, promptVersion, provider, model, parameters = {} }) {
  assertStage(stage);
  if (!inputHash || !promptVersion || !provider || !model) {
    throw new Error('stage, inputHash, promptVersion, provider and model are required');
  }
  const stableParameters = JSON.stringify(parameters, Object.keys(parameters).sort());
  return [stage, inputHash, promptVersion, provider, model, stableParameters].join(':');
}

function createGenerationRequest({ capability, model, prompt, referenceAssets = [], parameters = {} }) {
  assertCapability(capability);
  if (!model || typeof model !== 'string') throw new Error('model is required');
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt is required');
  return Object.freeze({
    capability,
    model,
    prompt,
    referenceAssets: [...referenceAssets],
    parameters: { ...parameters },
  });
}

function createStageRun({ jobId, stage, attempt = 1 }) {
  assertStage(stage);
  if (!jobId) throw new Error('jobId is required');
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
  return Object.freeze({ jobId, stage, attempt, status: 'QUEUED' });
}

module.exports = {
  STAGES,
  JOB_STATES,
  STAGE_TRANSITIONS,
  CAPABILITIES,
  PLATFORMS,
  ARTIFACT_TYPES,
  assertStage,
  assertCapability,
  canTransition,
  assertTransition,
  buildIdempotencyKey,
  createGenerationRequest,
  createStageRun,
};
