'use strict';

const { jsonrepair } = require('jsonrepair');

const SCHEMAS = Object.freeze({
  SCRIPT: Object.freeze({ required: ['title', 'scenes'] }),
  SHOT_PLAN: Object.freeze({ required: ['shots', 'continuity'] }),
  ASSET_PLAN: Object.freeze({ required: ['assets'] }),
});

function parseJsonOutput(stage, output) {
  if (typeof output !== 'string' || output.trim() === '') throw new Error(`${stage} returned empty output`);
  const candidates = [
    output.trim(),
    output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
  ];
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(jsonrepair(candidate)); } catch {}
  }
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(jsonrepair(output.slice(start, end + 1))); } catch {}
  }
  const error = new Error(`${stage} returned invalid JSON`);
  error.code = 'STRUCTURED_OUTPUT_INVALID_JSON';
  throw error;
}

function validateShape(stage, value) {
  const schema = SCHEMAS[stage];
  if (!schema) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${stage} must be a JSON object`);
  for (const field of schema.required) if (!(field in value)) throw new Error(`${stage} missing required field: ${field}`);

  if (stage === 'SCRIPT') {
    if (!Array.isArray(value.scenes) || value.scenes.length === 0) throw new Error('SCRIPT.scenes must be a non-empty array');
    value.scenes.forEach((scene, index) => {
      if (!scene || typeof scene !== 'object') throw new Error(`SCRIPT.scenes[${index}] must be an object`);
      if (scene.scene_number !== index + 1) throw new Error(`SCRIPT scene numbering invalid at index ${index}`);
      if (!scene.visual) throw new Error(`SCRIPT scene ${index + 1} missing visual`);
      if (scene.duration_seconds == null) throw new Error(`SCRIPT scene ${index + 1} missing duration_seconds`);
    });
  }

  if (stage === 'SHOT_PLAN') {
    if (!Array.isArray(value.shots) || value.shots.length === 0) throw new Error('SHOT_PLAN.shots must be a non-empty array');
    if (!value.continuity || typeof value.continuity !== 'object' || Array.isArray(value.continuity)) throw new Error('SHOT_PLAN.continuity must be an object');
    for (const key of ['characters', 'locations', 'products', 'wardrobe', 'props', 'visual_style']) {
      if (!(key in value.continuity)) throw new Error(`SHOT_PLAN.continuity missing ${key}`);
    }
    value.shots.forEach((shot, index) => {
      if (!shot || typeof shot !== 'object') throw new Error(`SHOT_PLAN.shots[${index}] must be an object`);
      for (const key of ['shot_id', 'scene_id', 'duration_seconds', 'framing', 'camera', 'subject', 'action', 'required_assets']) {
        if (!(key in shot)) throw new Error(`SHOT_PLAN shot ${index + 1} missing ${key}`);
      }
      if (!Array.isArray(shot.required_assets)) throw new Error(`SHOT_PLAN shot ${index + 1} required_assets must be an array`);
    });
  }

  if (stage === 'ASSET_PLAN') {
    if (!Array.isArray(value.assets) || value.assets.length === 0) throw new Error('ASSET_PLAN.assets must be a non-empty array');
    value.assets.forEach((asset, index) => {
      if (!asset || typeof asset !== 'object') throw new Error(`ASSET_PLAN.assets[${index}] must be an object`);
      for (const key of ['asset_id', 'kind', 'description', 'source_preference', 'generation_requirements', 'required_for_shots']) {
        if (!(key in asset)) throw new Error(`ASSET_PLAN asset ${index + 1} missing ${key}`);
      }
      if (!Array.isArray(asset.required_for_shots) || asset.required_for_shots.length === 0) {
        throw new Error(`ASSET_PLAN asset ${index + 1} required_for_shots must be a non-empty array`);
      }
    });
  }
  return value;
}

function toJsonArtifact({ stage, value, stageRun, response }) {
  return {
    artifactId: `${stageRun.job_id}:${stage}`,
    type: 'json',
    content: JSON.stringify(value, null, 2),
    provider: response.provenance?.provider || response.provider || null,
    model: response.provenance?.model || response.model || null,
    idempotencyKey: `${stageRun.job_id}:${stage}:structured:${stageRun.attempt}`,
  };
}

function buildStructuredPrompt({ stage, production, inputContents }) {
  const previous = inputContents.length ? `\nAuthoritative previous outputs:\n${inputContents.map((value, index) => `--- ${index + 1} ---\n${value}`).join('\n')}` : '';
  const instructions = {
    SCRIPT: 'Return JSON only. Produce {title, scenes[]}. Each scene must include scene_number, visual, duration_seconds, and dialogue_or_voiceover.',
    SHOT_PLAN: 'Return JSON only. Produce {shots[], continuity}. Each shot must include shot_id, scene_id, duration_seconds, framing, camera, subject, action, required_assets. continuity must define characters, locations, products, wardrobe, props and visual_style constraints.',
    ASSET_PLAN: 'Return JSON only. Produce {assets[]}. Each asset must include asset_id, kind, description, source_preference, generation_requirements, and required_for_shots[]. Reuse existing assets when possible.',
  };
  return `${instructions[stage]}\nProduction request:\n${JSON.stringify(production)}${previous}\nDo not contradict authoritative earlier outputs.`;
}

module.exports = { SCHEMAS, parseJsonOutput, validateShape, toJsonArtifact, buildStructuredPrompt };
