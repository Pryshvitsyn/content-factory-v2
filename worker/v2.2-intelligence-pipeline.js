'use strict';

const crypto = require('node:crypto');

const PLANNING_STAGES = Object.freeze([
  'BRIEF',
  'RESEARCH',
  'BIBLE',
  'CONCEPT',
  'SCRIPT',
  'SHOT_PLAN',
  'ASSET_PLAN',
]);

const STAGE_INPUTS = Object.freeze({
  BRIEF: ['IDEA'],
  RESEARCH: ['BRIEF'],
  BIBLE: ['BRIEF', 'RESEARCH'],
  CONCEPT: ['BIBLE'],
  SCRIPT: ['CONCEPT', 'BIBLE'],
  SHOT_PLAN: ['SCRIPT', 'BIBLE'],
  ASSET_PLAN: ['SHOT_PLAN', 'SCRIPT'],
});

const REQUIRED_FIELDS = Object.freeze({
  BRIEF: ['objective', 'audience', 'promise', 'constraints'],
  RESEARCH: ['facts', 'assumptions', 'sources'],
  BIBLE: ['tone', 'voice', 'visual_language', 'continuity_rules'],
  CONCEPT: ['title', 'logline', 'hook', 'structure'],
  SCRIPT: ['scenes', 'narration', 'duration_seconds'],
  SHOT_PLAN: ['shots'],
  ASSET_PLAN: ['assets'],
});

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function validateStageOutput(stage, output) {
  if (!PLANNING_STAGES.includes(stage)) throw new Error(`Unsupported planning stage: ${stage}`);
  assertObject(output, `${stage} output`);
  for (const field of REQUIRED_FIELDS[stage]) {
    if (!(field in output)) throw new Error(`${stage} output missing required field: ${field}`);
  }
  if (stage === 'SCRIPT' && (!Number.isFinite(output.duration_seconds) || output.duration_seconds <= 0)) {
    throw new Error('SCRIPT duration_seconds must be a positive number');
  }
  return true;
}

function buildPlanningEnvelope(stage, inputs, context = {}) {
  if (!PLANNING_STAGES.includes(stage)) throw new Error(`Unsupported planning stage: ${stage}`);
  for (const required of STAGE_INPUTS[stage]) {
    if (!(required in inputs)) throw new Error(`${stage} requires input artifact: ${required}`);
  }
  return {
    contract_version: '2.2',
    stage,
    objective: 'produce the next canonical planning artifact; do not invent unavailable evidence',
    input_fingerprints: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, fingerprint(value)])),
    context,
    output_schema: REQUIRED_FIELDS[stage],
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function executePlanningStage({ stage, inputs, context = {}, reasoner, timeoutMs = 30000 } = {}) {
  if (typeof reasoner !== 'function') throw new Error('reasoner function is required');
  const envelope = buildPlanningEnvelope(stage, inputs || {}, context);
  const raw = await withTimeout(reasoner(envelope), timeoutMs, `${stage} reasoning`);
  const output = typeof raw === 'string' ? JSON.parse(raw) : raw;
  validateStageOutput(stage, output);
  return {
    stage,
    output,
    input_fingerprint: fingerprint(inputs),
    output_fingerprint: fingerprint(output),
    contract_version: '2.2',
  };
}

module.exports = {
  PLANNING_STAGES,
  STAGE_INPUTS,
  REQUIRED_FIELDS,
  fingerprint,
  validateStageOutput,
  buildPlanningEnvelope,
  executePlanningStage,
};
