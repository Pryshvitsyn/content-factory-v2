'use strict';

const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');
const { planCreative } = require('./creative-director-planner');
const { LEGACY_FAST_MODEL } = require('./quality-video-profile');
const { createSpokenCopyPlan } = require('../v2.8.1/spoken-copy-contract');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECTIVES = new Set(['ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT']);
const MODES = new Set(['FAST', 'QUALITY']);

class OperatorInputError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'OperatorInputError';
    this.code = 'V27_INPUT_INVALID';
    this.details = details;
  }
}

function required(name, value, max = 4000) {
  if (typeof value !== 'string' || !value.trim()) throw new OperatorInputError(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new OperatorInputError(`${name} is too long`);
  return normalized;
}

function optional(value, max = 4000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new OperatorInputError('Optional text fields must be strings');
  const normalized = value.trim();
  if (normalized.length > max) throw new OperatorInputError('Optional text field is too long');
  return normalized || null;
}

function compactBrandContext(brand = {}) {
  const values = [
    brand.mission && `Mission: ${brand.mission}`,
    brand.positioning && `Positioning: ${brand.positioning}`,
    brand.products?.[0]?.valueProposition && `Product: ${brand.products[0].valueProposition}`,
    brand.audiences?.[0]?.problemStatement && `Audience: ${brand.audiences[0].problemStatement}`,
    brand.offers?.[0]?.promise && `Offer: ${brand.offers[0].promise}`,
    brand.campaigns?.[0]?.name && `Campaign: ${brand.campaigns[0].name}`,
  ].filter(Boolean);
  return values.join(' | ').slice(0, 1200) || null;
}

function buildRawInput(request, brand, { productionKey = null, qualityProfile = null } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new OperatorInputError('request must be an object');
  const brandId = required('brandId', request.brandId, 64);
  if (!UUID_PATTERN.test(brandId) || brand?.id !== brandId) throw new OperatorInputError('brandId is not a canonical selected brand');
  const requestId = required('requestId', request.requestId, 64);
  if (!UUID_PATTERN.test(requestId)) throw new OperatorInputError('requestId must be a UUID idempotency key');
  const mode = required('renderMode', request.renderMode, 16).toUpperCase();
  if (!MODES.has(mode)) throw new OperatorInputError('renderMode must be FAST or QUALITY');
  if (mode === 'QUALITY' && !qualityProfile) {
    throw new OperatorInputError('QUALITY production requires an explicit resolved quality video profile');
  }
  const objective = required('objective', request.objective, 64).toUpperCase();
  if (!OBJECTIVES.has(objective)) throw new OperatorInputError('objective is not canonical');
  const title = required('title', request.title, 240);
  const platform = required('platform', request.platform, 120);
  const duration = Number(request.targetDurationSeconds);
  if (!Number.isFinite(duration) || duration < 3 || duration > 60) {
    throw new OperatorInputError('targetDurationSeconds must be between 3 and 60');
  }
  const aspectRatio = required('aspectRatio', request.aspectRatio || '9:16', 12);
  if (aspectRatio !== '9:16') throw new OperatorInputError('The certified renderer currently supports 9:16 only');
  const hook = required('hook', request.hook, 800);
  const coreMessage = required('coreMessage', request.coreMessage || request.creativeBrief, 4000);
  const creativeBrief = required('creativeBrief', request.creativeBrief || request.coreMessage, 4000);
  const cta = required('cta', request.cta, 800);
  const explicitVoiceover = optional(request.voiceover, 2400);
  const visualDirection = optional(request.visualDirection, 2400)
    || 'Believable human behavior, cinematic naturalism, restrained camera, no app UI, no glossy stock-ad look.';
  const audience = optional(request.audience, 800);
  const campaign = optional(request.campaign, 800);
  const instructions = optional(request.additionalInstructions, 2400);
  const brandContext = compactBrandContext(brand);
  const profile = qualityProfile || { name: 'legacy-fast-test', provider: 'replicate', model: LEGACY_FAST_MODEL,
    resolution: '480p', numFrames: 81, framesPerSecond: 16, goFast: true,
    optimizePrompt: false, interpolateOutput: false, sampleShift: 12, seedStrategy: 'per-shot-deterministic' };
  const creativePlan = planCreative({ request: { ...request, creativeBrief }, brand, qualityProfile: profile });
  const count = creativePlan.shots.length;
  const spokenCopy = createSpokenCopyPlan({ hook, coreMessage, cta, explicitVoiceover, sceneCount: count });
  const scenes = creativePlan.shots.map((planned, index) => {
    const number = index + 1;
    return {
      scene_id: `operator-scene-${number}`,
      duration_seconds: planned.durationSeconds,
      location: planned.environment,
      visual: planned.description,
      emotional_intent: planned.emotionalIntent,
      dialogue_or_voiceover: spokenCopy.sceneSpokenCopy[index],
      shots: [{
        shot_id: planned.shotId,
        asset_id: planned.assetId,
        duration_seconds: planned.durationSeconds,
        framing: planned.framing,
        camera: planned.camera,
        subject: planned.subject,
        action: planned.action,
        continuity: `Use continuity identity ${planned.continuityIdentity}.`,
        video: { provider: profile.provider, ...(profile.vendor ? { vendor: profile.vendor } : {}), model: profile.model,
          ...(profile.modelVersion ? { model_version: profile.modelVersion } : {}), profile: profile.name, capability: profile.capability || 'TEXT_TO_VIDEO',
          resolved_settings: profile.resolvedSettings || {}, prompt: planned.generationPrompt,
          negative_intent: planned.negativeIntent,
          resolution: profile.resolution, aspect_ratio: aspectRatio, num_frames: profile.numFrames,
          frames_per_second: profile.framesPerSecond, go_fast: profile.goFast,
          optimize_prompt: profile.optimizePrompt, interpolate_output: profile.interpolateOutput,
          sample_shift: profile.sampleShift, ...(planned.seed === undefined ? {} : { seed: planned.seed }) },
      }],
    };
  });
  const captionsEnabled = request.captionsEnabled === true;
  const musicEnabled = request.musicEnabled === true;
  return {
    schema_version: '2.6',
    render_mode: mode,
    brand_id: brandId,
    production_key: productionKey || `operator-${requestId}`,
    title,
    objective,
    target_platform: platform,
    target_duration_seconds: duration,
    aspect_ratio: aspectRatio,
    hook,
    core_message: coreMessage,
    approved_spoken_copy: spokenCopy.approvedSpokenCopy,
    spoken_copy_policy: {
      contract_version: spokenCopy.contractVersion,
      source: spokenCopy.source,
      strict_approved_copy: spokenCopy.strictApprovedCopy,
    },
    creative_concept: [mode === 'QUALITY' ? `Narrative arc: ${hook} → ${coreMessage} → ${cta}` : creativeBrief,
      brandContext && `Brand context: ${brandContext}`].filter(Boolean).join('\n'),
    cta,
    creative_plan: creativePlan,
    quality_video_profile: mode === 'QUALITY' ? profile : null,
    provider_selection: mode === 'QUALITY' ? { provider: profile.provider, vendor: profile.vendor || null,
      model: profile.model, model_version: profile.modelVersion || null, profile: profile.name,
      capability: profile.capability || 'TEXT_TO_VIDEO', resolved_settings: profile.resolvedSettings || {} } : null,
    scenes,
    voiceover: { enabled: true, asset_id: 'voiceover-main',
      ...(mode === 'QUALITY' ? { provider: 'openai-media', model: 'gpt-4o-mini-tts', voice: 'alloy' }
        : { voice: optional(request.voice, 120) || 'en-US-AvaNeural-Female' }),
      language: optional(request.language, 24) || 'en',
      instructions: optional(request.voiceoverInstructions, 1000) || 'Warm, clear, natural delivery. Speech intelligibility has priority.',
      text: spokenCopy.approvedSpokenCopy },
    continuity: {
      characters: ['Characters and human details explicitly described in the operator brief'],
      locations: ['Location and layout explicitly described in the operator brief'],
      products: [brand.name], wardrobe: ['Wardrobe explicitly described in the operator brief'], props: [],
      visual_style: visualDirection,
      character_rules: 'Repeat concrete character descriptions from the operator brief in every generated beat.',
      location_rules: 'Preserve location, lighting, wardrobe, lens, and color language across generated beats.',
    },
    // Keep the same key order PostgreSQL jsonb returns. V2.5 embeds this object
    // as JSON in the generated prompt, so a durable round-trip must not alter
    // the canonical fingerprint.
    visual_style: { avoid: ['app UI', 'secret text', 'glossy stock-ad behavior'], direction: visualDirection },
    audio: { ambience_intent: optional(request.ambience, 800) || 'Subtle ambience below speech.',
      music_intent: musicEnabled ? 'Restrained background music below speech.' : 'No generated music.', speech_priority: true },
    captions: { enabled: captionsEnabled,
      intent: captionsEnabled && mode === 'FAST' ? 'Burned-in renderer captions.' : 'Disabled or not renderer-supported.',
      end_title: captionsEnabled && mode === 'FAST' ? `${brand.name} — ${cta}` : null },
    ...(mode === 'FAST' ? { fast_render: { renderer: 'moneyprinterturbo', media_source: 'pexels',
      captions: captionsEnabled, music: musicEnabled, provider_options: {
        voice_name: optional(request.voice, 120) || 'en-US-AvaNeural-Female',
        clip_duration_seconds: 5, concat_mode: 'sequential', match_materials_to_script: true,
        ...(captionsEnabled ? { subtitle_position: 'bottom' } : {}),
      } } } : {}),
    publication_policy: { requires_human_approval: true, auto_publish: false, destination: 'disabled' },
  };
}

function buildOperatorProductionInput(request, brand, options = {}) {
  const canonicalRawInput = buildRawInput(request, brand, options);
  const base = buildProductionInput(canonicalRawInput);
  const withoutFingerprint = { ...base, productionNamespace: 'v2.7-operator' };
  delete withoutFingerprint.fingerprint;
  const input = Object.freeze({ ...withoutFingerprint, fingerprint: stableFingerprint(withoutFingerprint) });
  const canonicalRequest = Object.freeze({
    requestId: request.requestId,
    brandId: input.brandId,
    title: input.title,
    objective: input.objective,
    platform: input.targetPlatform,
    targetDurationSeconds: input.targetDurationSeconds,
    aspectRatio: input.aspectRatio,
    renderMode: input.renderMode,
    providerSelection: input.renderMode === 'QUALITY' ? Object.freeze({
      provider: input.qualityVideoProfile.provider, vendor: input.qualityVideoProfile.vendor || null,
      model: input.qualityVideoProfile.model, modelVersion: input.qualityVideoProfile.modelVersion || null,
      profile: input.qualityVideoProfile.name, capability: input.qualityVideoProfile.capability || 'TEXT_TO_VIDEO',
      resolvedSettings: input.qualityVideoProfile.resolvedSettings || {},
    }) : null,
    hook: input.hook,
    coreMessage: input.coreMessage,
    creativeBrief: required('creativeBrief', request.creativeBrief || request.coreMessage, 4000),
    cta: input.cta,
    voiceover: input.voiceover.text,
    sceneIdeas: optional(request.sceneIdeas, 2400),
    visualDirection: optional(request.visualDirection, 2400),
    audience: optional(request.audience, 800),
    campaign: optional(request.campaign, 800),
    additionalInstructions: optional(request.additionalInstructions, 2400),
    location: optional(request.location, 400),
    emotionalIntent: optional(request.emotionalIntent, 800),
    framing: optional(request.framing, 400),
    camera: optional(request.camera, 400),
    subject: optional(request.subject, 800),
    voice: optional(request.voice, 120),
    language: optional(request.language, 24),
    voiceoverInstructions: optional(request.voiceoverInstructions, 1000),
    ambience: optional(request.ambience, 800),
    captionsEnabled: input.captions.enabled,
    musicEnabled: request.musicEnabled === true,
    publicationPolicy: input.publicationPolicy,
  });
  return Object.freeze({ input, canonicalRawInput: Object.freeze(canonicalRawInput), canonicalRequest });
}

module.exports = { OperatorInputError, buildOperatorProductionInput, buildRawInput, compactBrandContext };
