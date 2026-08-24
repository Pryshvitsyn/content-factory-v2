'use strict';

const crypto = require('node:crypto');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');

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

function shotCount(duration) { return Math.max(1, Math.ceil(duration / 5)); }

function sceneCopy({ index, count, hook, coreMessage, cta }) {
  if (count === 1) return `${hook} ${coreMessage} ${cta}`;
  if (index === 0) return hook;
  if (index === count - 1) return cta;
  return coreMessage;
}

function buildRawInput(request, brand, { productionKey = null } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new OperatorInputError('request must be an object');
  const brandId = required('brandId', request.brandId, 64);
  if (!UUID_PATTERN.test(brandId) || brand?.id !== brandId) throw new OperatorInputError('brandId is not a canonical selected brand');
  const requestId = required('requestId', request.requestId, 64);
  if (!UUID_PATTERN.test(requestId)) throw new OperatorInputError('requestId must be a UUID idempotency key');
  const mode = required('renderMode', request.renderMode, 16).toUpperCase();
  if (!MODES.has(mode)) throw new OperatorInputError('renderMode must be FAST or QUALITY');
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
  const voiceoverText = optional(request.voiceover, 2400) || `${hook} ${coreMessage} ${cta}`;
  const sceneIdeas = (optional(request.sceneIdeas, 2400) || '').split(/\n|;/).map((item) => item.trim()).filter(Boolean);
  const visualDirection = optional(request.visualDirection, 2400)
    || 'Believable human behavior, cinematic naturalism, restrained camera, no app UI, no glossy stock-ad look.';
  const audience = optional(request.audience, 800);
  const campaign = optional(request.campaign, 800);
  const instructions = optional(request.additionalInstructions, 2400);
  const brandContext = compactBrandContext(brand);
  const count = shotCount(duration);
  const segmentDuration = duration / count;
  const seed = Number.parseInt(crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 8), 16) % 2147483647;
  const scenes = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const visual = sceneIdeas[index] || sceneIdeas.at(-1)
      || `${creativeBrief} — visual beat ${number} of ${count}.`;
    const copy = sceneCopy({ index, count, hook, coreMessage, cta });
    const prompt = [
      `Operator creative brief: ${creativeBrief}`,
      `Visual beat ${number}: ${visual}`,
      `Core message: ${coreMessage}`,
      `Visual direction: ${visualDirection}`,
      audience && `Audience context: ${audience}`,
      campaign && `Campaign context: ${campaign}`,
      brandContext && `Brand Brain reference context (operator brief has priority): ${brandContext}`,
      instructions && `Additional operator instructions: ${instructions}`,
      'Vertical social video. Believable behavior. No app UI, no credentials, no phone close-up, no generated text, no automatic publication.',
    ].filter(Boolean).join('\n');
    return {
      scene_id: `operator-scene-${number}`,
      duration_seconds: segmentDuration,
      location: optional(request.location, 400) || 'Location defined by the operator creative brief',
      visual,
      emotional_intent: optional(request.emotionalIntent, 800) || 'Natural, specific, emotionally credible behavior.',
      dialogue_or_voiceover: copy,
      shots: [{
        shot_id: `operator-shot-${number}`,
        asset_id: `operator-video-${number}`,
        duration_seconds: segmentDuration,
        framing: optional(request.framing, 400) || 'vertical cinematic medium shot',
        camera: optional(request.camera, 400) || 'restrained observational camera',
        subject: optional(request.subject, 800) || `Subjects described in the creative brief: ${creativeBrief}`,
        action: visual,
        continuity: `Maintain the operator's visual direction across beat ${number}.`,
        video: { prompt, resolution: '480p', aspect_ratio: aspectRatio, num_frames: 81,
          frames_per_second: 16, go_fast: true, seed },
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
    creative_concept: [creativeBrief, brandContext && `Brand context: ${brandContext}`].filter(Boolean).join('\n'),
    cta,
    scenes,
    voiceover: { enabled: true, asset_id: 'voiceover-main',
      ...(mode === 'QUALITY' ? { provider: 'openai-media', model: 'gpt-4o-mini-tts', voice: 'alloy' }
        : { voice: optional(request.voice, 120) || 'en-US-AvaNeural-Female' }),
      language: optional(request.language, 24) || 'en',
      instructions: optional(request.voiceoverInstructions, 1000) || 'Warm, clear, natural delivery. Speech intelligibility has priority.',
      text: voiceoverText },
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
