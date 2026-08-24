'use strict';

const crypto = require('node:crypto');
const { buildWanInput, DEFAULT_MODEL: DEFAULT_VIDEO_MODEL } = require('../providers/replicate-wan-video-adapter');
const { DEFAULT_SPEECH_MODEL } = require('../providers/openai-media-provider');
const { validateStructuredConsistency } = require('../../worker/v2.1-production-orchestrator');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const OBJECTIVES = new Set(['ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT']);

class ProductionInputError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ProductionInputError';
    this.code = 'V25_INPUT_INVALID';
    this.details = details;
  }
}

function object(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductionInputError(`${name} must be an object`);
  return value;
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new ProductionInputError(`${name} is required`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ProductionInputError(`${name} must be a positive number`);
  return parsed;
}

function unique(name, values) {
  if (new Set(values).size !== values.length) throw new ProductionInputError(`${name} values must be unique`);
}

function stableFingerprint(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    return input;
  };
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function normalizeContinuity(raw = {}) {
  const continuity = object('continuity', raw);
  const list = (name) => {
    const value = continuity[name] ?? [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new ProductionInputError(`continuity.${name} must be an array of non-empty strings`);
    }
    return value.map((item) => item.trim());
  };
  return Object.freeze({
    characters: list('characters'),
    locations: list('locations'),
    products: list('products'),
    wardrobe: list('wardrobe'),
    props: list('props'),
    visual_style: text('continuity.visual_style', continuity.visual_style),
    character_rules: optionalText(continuity.character_rules),
    location_rules: optionalText(continuity.location_rules),
  });
}

function normalizePublicationPolicy(raw = {}) {
  const policy = object('publication_policy', raw);
  if (policy.requires_human_approval !== true) throw new ProductionInputError('publication_policy.requires_human_approval must be true');
  if (policy.auto_publish !== false) throw new ProductionInputError('publication_policy.auto_publish must be false');
  return Object.freeze({ requiresHumanApproval: true, autoPublish: false, destination: optionalText(policy.destination) });
}

function normalizeVideoProfile(raw, aspectRatio) {
  const video = object('shot.video', raw);
  const profile = {
    provider: video.provider || 'replicate',
    model: video.model || DEFAULT_VIDEO_MODEL,
    prompt: text('shot.video.prompt', video.prompt),
    resolution: video.resolution || '480p',
    aspectRatio: video.aspect_ratio || aspectRatio,
    numFrames: Number(video.num_frames ?? 81),
    framesPerSecond: Number(video.frames_per_second ?? 16),
    goFast: video.go_fast ?? true,
    seed: video.seed,
  };
  if (profile.provider !== 'replicate') throw new ProductionInputError('shot.video.provider must currently be replicate');
  if (!Number.isInteger(profile.numFrames) || !Number.isInteger(profile.framesPerSecond)) {
    throw new ProductionInputError('shot.video frame settings must be integers');
  }
  if (typeof profile.goFast !== 'boolean') throw new ProductionInputError('shot.video.go_fast must be a boolean');
  buildWanInput(profile);
  return Object.freeze(profile);
}

function buildProductionInput(raw = {}) {
  object('input', raw);
  if (raw.schema_version !== '2.5') throw new ProductionInputError('schema_version must be 2.5');
  const brandId = text('brand_id', raw.brand_id);
  if (!UUID_PATTERN.test(brandId)) throw new ProductionInputError('brand_id must be a UUID');
  const productionKey = text('production_key', raw.production_key);
  if (!KEY_PATTERN.test(productionKey)) throw new ProductionInputError('production_key has invalid characters or length');
  const title = text('title', raw.title);
  const objective = text('objective', raw.objective);
  if (!OBJECTIVES.has(objective)) throw new ProductionInputError('objective is not canonical');
  const targetPlatform = text('target_platform', raw.target_platform);
  const targetDurationSeconds = positiveNumber('target_duration_seconds', raw.target_duration_seconds);
  const aspectRatio = text('aspect_ratio', raw.aspect_ratio);
  if (aspectRatio !== '9:16') throw new ProductionInputError('V2.5 currently supports the 9:16 aspect ratio');
  const hook = text('hook', raw.hook);
  const coreMessage = text('core_message', raw.core_message);
  const creativeConcept = text('creative_concept', raw.creative_concept);
  const cta = text('cta', raw.cta);
  const continuity = normalizeContinuity(raw.continuity);
  const publicationPolicy = normalizePublicationPolicy(raw.publication_policy);
  const visualStyle = object('visual_style', raw.visual_style);
  const audioIntent = object('audio', raw.audio);
  const captions = object('captions', raw.captions);
  if (typeof captions.enabled !== 'boolean') throw new ProductionInputError('captions.enabled must be a boolean');

  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new ProductionInputError('scenes must be a non-empty array');
  const sceneIds = raw.scenes.map((scene, index) => text(`scenes[${index}].scene_id`, scene?.scene_id));
  unique('scene_id', sceneIds);
  const shots = [];
  const scriptScenes = [];
  const videoAssets = [];
  let plannedDurationSeconds = 0;

  raw.scenes.forEach((rawScene, sceneIndex) => {
    const scene = object(`scenes[${sceneIndex}]`, rawScene);
    const sceneDuration = positiveNumber(`scenes[${sceneIndex}].duration_seconds`, scene.duration_seconds);
    if (!Array.isArray(scene.shots) || scene.shots.length === 0) throw new ProductionInputError(`scenes[${sceneIndex}].shots must be non-empty`);
    const dialogue = optionalText(scene.dialogue_or_voiceover) || '';
    const shotDuration = scene.shots.reduce((sum, shot, shotIndex) => sum + positiveNumber(
      `scenes[${sceneIndex}].shots[${shotIndex}].duration_seconds`, shot?.duration_seconds,
    ), 0);
    if (Math.abs(shotDuration - sceneDuration) > 0.05) {
      throw new ProductionInputError(`Scene ${scene.scene_id} shot durations must equal scene duration`, { sceneDuration, shotDuration });
    }
    scriptScenes.push({
      scene_number: sceneIndex + 1,
      scene_id: scene.scene_id,
      visual: text(`scenes[${sceneIndex}].visual`, scene.visual),
      duration_seconds: sceneDuration,
      dialogue_or_voiceover: dialogue,
      location: text(`scenes[${sceneIndex}].location`, scene.location),
      emotional_intent: optionalText(scene.emotional_intent),
    });
    plannedDurationSeconds += sceneDuration;

    scene.shots.forEach((rawShot, shotIndex) => {
      const shot = object(`scenes[${sceneIndex}].shots[${shotIndex}]`, rawShot);
      const shotId = text(`scenes[${sceneIndex}].shots[${shotIndex}].shot_id`, shot.shot_id);
      const durationSeconds = positiveNumber(`shot ${shotId}.duration_seconds`, shot.duration_seconds);
      const assetId = text(`shot ${shotId}.asset_id`, shot.asset_id || `video-${shotId}`);
      const profile = normalizeVideoProfile(shot.video, aspectRatio);
      const generationDurationMs = Math.round((profile.numFrames / profile.framesPerSecond) * 1000);
      const continuityPrompt = [
        `Creative concept: ${creativeConcept}`,
        `Core message: ${coreMessage}`,
        `Scene: ${scene.visual}`,
        `Shot action: ${text(`shot ${shotId}.action`, shot.action)}`,
        `Continuity: ${continuity.visual_style}`,
        continuity.character_rules && `Character continuity: ${continuity.character_rules}`,
        continuity.location_rules && `Location continuity: ${continuity.location_rules}`,
        `Visual style: ${JSON.stringify(visualStyle)}`,
        `Base prompt: ${profile.prompt}`,
      ].filter(Boolean).join('\n');
      shots.push({
        shot_id: shotId,
        scene_id: String(sceneIndex + 1),
        operator_scene_id: scene.scene_id,
        duration_seconds: durationSeconds,
        framing: text(`shot ${shotId}.framing`, shot.framing),
        camera: text(`shot ${shotId}.camera`, shot.camera),
        subject: text(`shot ${shotId}.subject`, shot.subject),
        action: text(`shot ${shotId}.action`, shot.action),
        continuity: optionalText(shot.continuity),
        required_assets: [assetId],
      });
      videoAssets.push({
        asset_id: assetId,
        kind: 'video',
        description: profile.prompt,
        source_preference: 'generate',
        generation_requirements: {
          role: 'primary_visual',
          provider: profile.provider,
          model: profile.model,
          prompt: continuityPrompt,
          resolution: profile.resolution,
          aspect_ratio: profile.aspectRatio,
          num_frames: profile.numFrames,
          frames_per_second: profile.framesPerSecond,
          go_fast: profile.goFast,
          ...(profile.seed !== undefined ? { seed: profile.seed } : {}),
          temporal: { startMs: 0, endMs: generationDurationMs, durationMs: generationDurationMs },
          target_clip_duration_ms: Math.round(durationSeconds * 1000),
          continuity: { ...continuity, shot: optionalText(shot.continuity) },
        },
        required_for_shots: [shotId],
      });
    });
  });

  unique('shot_id', shots.map((shot) => shot.shot_id));
  unique('asset_id', videoAssets.map((asset) => asset.asset_id));
  if (Math.abs(plannedDurationSeconds - targetDurationSeconds) > 0.25) {
    throw new ProductionInputError('scene durations must equal target_duration_seconds', { targetDurationSeconds, plannedDurationSeconds });
  }

  const voiceover = object('voiceover', raw.voiceover);
  if (typeof voiceover.enabled !== 'boolean') throw new ProductionInputError('voiceover.enabled must be a boolean');
  const assets = [...videoAssets];
  if (voiceover.enabled) {
    const voiceText = text('voiceover.text', voiceover.text);
    const voiceAssetId = text('voiceover.asset_id', voiceover.asset_id || 'voiceover-main');
    const voiceProvider = voiceover.provider || 'openai-media';
    const voiceModel = voiceover.model || DEFAULT_SPEECH_MODEL;
    assets.push({
      asset_id: voiceAssetId,
      kind: 'voice',
      description: voiceText,
      source_preference: 'generate',
      generation_requirements: {
        provider: voiceProvider,
        model: voiceModel,
        text: voiceText,
        voice: text('voiceover.voice', voiceover.voice),
        instructions: optionalText(voiceover.instructions),
        language: voiceover.language || 'en',
        temporal: { startMs: 0, endMs: Math.round(targetDurationSeconds * 1000), durationMs: Math.round(targetDurationSeconds * 1000) },
      },
      required_for_shots: shots.map((shot) => shot.shot_id),
    });
    shots.forEach((shot) => shot.required_assets.push(voiceAssetId));
  }

  const script = { brand_id: brandId, title, hook, core_message: coreMessage, cta, scenes: scriptScenes };
  const shotPlan = { brand_id: brandId, shots, continuity };
  const assetPlan = { brand_id: brandId, assets };
  validateStructuredConsistency('SCRIPT', script, []);
  validateStructuredConsistency('SHOT_PLAN', shotPlan, [JSON.stringify(script)]);
  validateStructuredConsistency('ASSET_PLAN', assetPlan, [JSON.stringify(shotPlan)]);

  const normalized = {
    schemaVersion: 2,
    brandId,
    productionKey,
    liveTestKey: productionKey,
    productionNamespace: 'v2.5-real',
    title,
    objective,
    targetPlatform,
    targetDurationSeconds,
    aspectRatio,
    hook,
    coreMessage,
    creativeConcept,
    cta,
    continuity,
    visualStyle,
    audioIntent,
    captions: { ...captions },
    publicationPolicy,
    voiceover: { ...voiceover },
    script,
    shotPlan,
    assetPlan,
    profile: videoAssets[0].generation_requirements,
  };
  return Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
}

module.exports = {
  ProductionInputError,
  buildProductionInput,
  normalizePublicationPolicy,
  stableFingerprint,
};
