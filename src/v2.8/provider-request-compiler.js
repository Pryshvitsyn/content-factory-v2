'use strict';

const crypto = require('node:crypto');
const { fingerprint, freeze } = require('../v2.10/creative-contract');
const { fromAsset } = require('./canonical-media-request');

// A deliberate version boundary: persisted preflights from an older compiler cannot authorize this payload.
const COMPILER_VERSION = 'provider-request/5';
const VERIFIED_AT = '2026-11-07';
const LOCAL_VIDEO_PROMPT_BUDGET = 4000; // Unicode code points; operational policy, NOT a claimed upstream limit.
const keyOf = (r) => `${r.providerSelection.provider}/${r.providerSelection.model}`;
function invalid(code, message, details = {}) {
  const error = Object.assign(new Error(message), { code, status: 409, boundaryState: 'NOT_CROSSED', details: { ...details,
    operation: 'LOCAL_INPUT_VALIDATION', providerExecutionOutcome: 'REJECTED_BEFORE_CREATION' } });
  throw error;
}
function textLength(text, unit = 'UNICODE_CODE_POINTS') {
  const value = String(text || '');
  return unit === 'UTF16_CODE_UNITS' ? value.length : Array.from(value).length;
}
function assertTextLimit(text, maximum, source = 'PROVIDER_DOCUMENTATION', unit = 'UNICODE_CODE_POINTS') {
  const actual = textLength(text, unit);
  if (!actual) invalid('CANONICAL_PROMPT_REQUIRED', 'Final provider prompt must not be empty');
  if (actual > maximum) invalid('FINAL_PROMPT_TOO_LONG',
    `Final provider prompt contains ${actual} ${unit === 'UTF16_CODE_UNITS' ? 'UTF-16 code units' : 'Unicode characters'}; limit ${maximum} (${source}). Edit the shot requirements and run preflight again; nothing was truncated.`,
    { actual, maximum, unit, source });
  return actual;
}
const CONTRACTS = Object.freeze({
  'replicate/wan-video/wan-2.2-t2v-fast': { capabilities: ['TEXT_TO_VIDEO'], resolutions: ['480p','720p'], duration: [1,30], audio: false },
  'replicate/alibaba/wan-3': { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO'], resolutions: ['480p','720p','1080p'], duration: [2,30], audio: false },
  'replicate/bytedance/seedance-2.5': { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO'], resolutions: ['480p','720p'], duration: [4,30], audio: true },
  'fal/bytedance/seedance-2.0/text-to-video': { capabilities: ['TEXT_TO_VIDEO'], resolutions: ['480p','720p','1080p','4k'], duration: [4,15], audio: true },
  'fal/bytedance/seedance-2.5/text-to-video': { capabilities: ['TEXT_TO_VIDEO'], resolutions: ['480p','720p','1080p'], duration: [4,30], audio: true },
  'runway/gen4.5': { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO'], resolutions: ['720p'], duration: [2,10], audio: false, promptLimit: 1000, promptLimitUnit: 'UTF16_CODE_UNITS' },
  'luma/ray-2': { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO'], resolutions: ['720p','1080p'], durations: [5,9], audio: false },
  'alibaba/wan3.0-video': { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO'], resolutions: ['480p','720p','1080p'], duration: [2,30], audio: true, promptLimit: 20000 },
});

function contractFor(request) {
  const key = keyOf(request);
  if (key === 'google/veo-3.1-generate-preview') invalid('MODEL_RETIRED',
    'Google Gemini API veo-3.1-generate-preview was shut down on 2026-10-22. Select and approve a supported model; automatic substitution is disabled.');
  const contract = CONTRACTS[key];
  if (!contract) invalid('PROVIDER_CONTRACT_UNVERIFIED', `No verified request compiler for ${key}; this model cannot be READY`);
  return contract;
}
function validateVideoRequest(request, { deferredReferences = false } = {}) {
  if (request.requestCompilerVersion && request.requestCompilerVersion !== COMPILER_VERSION) invalid('STALE_PROVIDER_PREFLIGHT', 'The persisted input requires a different request compiler; a fresh reviewed preflight is required');
  const contract = contractFor(request);
  const expectedFamily = /wan/i.test(request.providerSelection.model) ? 'wan' : /seedance/i.test(request.providerSelection.model) ? 'seedance'
    : /^gen4/.test(request.providerSelection.model) ? 'runway' : /^ray-/.test(request.providerSelection.model) ? 'luma' : null;
  for (const match of request.providerPrompt.matchAll(/\b(Wan|Seedance|Runway|Veo|Luma) instruction:/gi)) {
    if (match[1].toLowerCase() !== expectedFamily) invalid('FOREIGN_MODEL_INSTRUCTION', 'Shot contains instructions for a different model; review its source before preflight');
  }
  if (request.seed != null && request.providerSelection.provider === 'fal') invalid('UNSUPPORTED_SEED', 'The verified fal text-to-video schema does not accept a seed input');
  if (request.negativePrompt && keyOf(request) !== 'replicate/alibaba/wan-3') invalid('UNSUPPORTED_NEGATIVE_PROMPT', 'Selected model has no verified negative_prompt field; include approved negative guidance in the canonical shot');
  if (request.negativePrompt) assertTextLimit(request.negativePrompt, LOCAL_VIDEO_PROMPT_BUDGET, 'LOCAL_OPERATIONAL_BUDGET');
  const max = contract.promptLimit || LOCAL_VIDEO_PROMPT_BUDGET;
  assertTextLimit(request.providerPrompt, max, contract.promptLimit ? 'PROVIDER_DOCUMENTATION' : 'LOCAL_OPERATIONAL_BUDGET', contract.promptLimitUnit);
  // The current Replicate transport has no verified portrait authorization path.
  // This is a local adapter restriction, not a claim that every image contains people.
  // A filename, an AI-generated label, or a caller-controlled flag cannot waive it.
  if (keyOf(request) === 'replicate/bytedance/seedance-2.5' && request.capability !== 'TEXT_TO_VIDEO') {
    invalid('REFERENCE_ELIGIBILITY_UNVERIFIED', 'This Seedance reference route has no verified portrait eligibility/authorization path. Review a compatible route or an authorized reference workflow; no automatic retry or model switch is allowed.');
  }
  if (!contract.capabilities.includes(request.capability)) invalid('CAPABILITY_UNSUPPORTED', `${keyOf(request)} has no verified ${request.capability} request path`);
  if (!contract.resolutions.includes(request.resolution)) invalid('UNSUPPORTED_RESOLUTION', `${keyOf(request)} does not support resolution ${request.resolution}`);
  const duration = request.durationSeconds ?? Number(request.resolvedSettings.duration || 5);
  if (!Number.isInteger(duration) || (contract.duration && (duration < contract.duration[0] || duration > contract.duration[1]))
    || (contract.durations && !contract.durations.includes(duration))) invalid('UNSUPPORTED_DURATION',
    `Deterministic storyboard duration ${duration}s is unsupported by ${keyOf(request)}; intelligent duration requires a separately approved timeline`);
  if (!['9:16','16:9','1:1','4:3','3:4','21:9','adaptive','auto'].includes(request.aspectRatio)) invalid('UNSUPPORTED_ASPECT_RATIO', 'Unsupported canonical aspect ratio');
  // Validate the exact installed route, not the union of every vendor's enums.
  const routeRatios = request.providerSelection.provider === 'runway' ? ['9:16','16:9']
    : request.providerSelection.provider === 'fal' ? ['auto','21:9','16:9','4:3','1:1','3:4','9:16'] : null;
  if (routeRatios && !routeRatios.includes(request.aspectRatio)) invalid('UNSUPPORTED_ASPECT_RATIO',
    `${keyOf(request)} does not support aspect ratio ${request.aspectRatio}; silent substitution is not allowed`);
  if (request.audio.requested && !contract.audio) invalid('NATIVE_AUDIO_UNSUPPORTED', `${keyOf(request)} cannot generate the requested native audio`);
  const refs = request.references;
  const images = [...refs.characterImages, ...refs.styleImages];
  if (refs.lastFrame && !refs.firstFrame) invalid('REFERENCE_FIRST_FRAME_REQUIRED', 'A last frame requires a first frame');
  if ((refs.firstFrame || refs.lastFrame) && (images.length || refs.referenceVideos.length || refs.referenceAudios.length)) invalid('REFERENCE_MODE_CONFLICT', 'First/last frames and reference media cannot be mixed');
  if (refs.referenceVideos.length || refs.referenceAudios.length) invalid('REFERENCE_MEDIA_INSPECTION_REQUIRED',
    'Video/audio reference duration, format and size evidence is unavailable in this execution path; no paid request is allowed');
  if (!deferredReferences && request.capability === 'IMAGE_TO_VIDEO' && !refs.firstFrame) invalid('REFERENCE_EVIDENCE_MISSING', 'IMAGE_TO_VIDEO requires its materialized approved first frame');
  if (!deferredReferences && request.capability === 'REFERENCE_TO_VIDEO' && !images.length) invalid('REFERENCE_EVIDENCE_MISSING', 'REFERENCE_TO_VIDEO requires materialized reference images');
  if (request.capability === 'TEXT_TO_VIDEO' && (refs.firstFrame || refs.lastFrame || images.length)) invalid('REFERENCE_MODE_CONFLICT', 'TEXT_TO_VIDEO cannot carry reference media');
  if (keyOf(request) === 'replicate/alibaba/wan-3' && (refs.lastFrame || images.length)) invalid('CAPABILITY_UNSUPPORTED', 'Replicate Wan 3 accepts only one first-frame image');
  if (request.providerSelection.provider === 'luma' && [refs.firstFrame, refs.lastFrame].filter(Boolean).some(value => value.startsWith('data:'))) invalid('REFERENCE_TRANSPORT_UNVERIFIED', 'Luma keyframe URLs must be publicly hosted immutable images; this path has only inline bytes');
  if (request.providerSelection.provider === 'runway' && refs.lastFrame) invalid('CAPABILITY_UNSUPPORTED', 'This Runway adapter has no last-frame mapping');
  if (images.length > (request.providerSelection.provider === 'alibaba' ? 10 : 30)) invalid('REFERENCE_LIMIT_EXCEEDED', 'Too many reference images');
  for (const uri of [refs.firstFrame, refs.lastFrame, ...images].filter(Boolean)) {
    if (typeof uri !== 'string' || !/^(https?:\/\/|data:image\/(png|jpeg|webp|bmp);base64,)/.test(uri)) invalid('REFERENCE_FORMAT_UNSUPPORTED', 'Reference must be an image URL or supported image data URI');
    if (uri.startsWith('data:') && Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').length > 10 * 1024 * 1024) invalid('REFERENCE_SIZE_EXCEEDED', 'Image exceeds the local 10 MiB reference budget');
  }
  if (request.seed != null && request.seed > 2147483647) invalid('CANONICAL_SEED_INVALID', 'Seed exceeds the verified 32-bit range');
  return contract;
}
function compileVideoRequest(request, { protocol = null, env = process.env, endpoint = null } = {}) {
  validateVideoRequest(request);
  if (keyOf(request) === 'replicate/alibaba/wan-3') require('../providers/replicate-universal-video-adapter').assertWan3ReferenceGeometry(request, request.references, request.aspectRatio);
  const provider = request.providerSelection.provider;
  const model = request.providerSelection.model;
  const refs = request.references;
  const settings = request.resolvedSettings;
  let payload, target;
  if (provider === 'replicate') {
    const common = { prompt: request.providerPrompt, resolution: request.resolution, aspectRatio: request.aspectRatio,
      duration: request.durationSeconds ?? Number(settings.duration || 5), ...(request.seed == null ? {} : { seed: request.seed }) };
    let input;
    if (model === 'wan-video/wan-2.2-t2v-fast') {
      input = require('../providers/replicate-wan-video-adapter').buildWanInput({ ...common,
        numFrames: settings.numFrames ?? settings.num_frames ?? 81,
        framesPerSecond: settings.framesPerSecond ?? settings.frames_per_second ?? 16,
        goFast: settings.goFast ?? settings.go_fast ?? true, sampleShift: settings.sampleShift ?? settings.sample_shift ?? 12,
        optimizePrompt: settings.optimizePrompt ?? settings.optimize_prompt,
        interpolateOutput: settings.interpolateOutput ?? settings.interpolate_output });
      // Frame-based output must cover the reviewed clip; longer generated footage
      // may be trimmed by the existing timeline renderer. Allow one frame of rounding. Do not claim 30 seconds for an 81-frame clip.
      const actualDuration = input.num_frames / input.frames_per_second;
      if (actualDuration + 1 / input.frames_per_second + 1e-9 < common.duration) {
        invalid('PROVIDER_DURATION_MISMATCH', 'Wan 2.2 frame count and FPS do not cover the reviewed clip duration',
          { requestedDurationSeconds: common.duration, nominalDurationSeconds: actualDuration });
      }
    } else {
      const builders = require('../providers/replicate-universal-video-adapter');
      input = model === 'alibaba/wan-3' ? builders.buildWan3Input({ ...common, image: refs.firstFrame,
        negativePrompt: request.negativePrompt, enablePromptExpansion: settings.enablePromptExpansion ?? true })
        : builders.buildSeedance25Input({ ...common, image: refs.firstFrame, lastFrameImage: refs.lastFrame,
          referenceImages: [...refs.characterImages, ...refs.styleImages], referenceVideos: refs.referenceVideos,
          referenceAudios: refs.referenceAudios, generateAudio: request.audio.requested, watermark: settings.watermark ?? false });
    }
    payload = { input }; target = `https://api.replicate.com/v1/models/${model}/predictions`;
  } else {
    const protocols = require('./provider-protocols');
    const selectedProtocol = protocol || (provider === 'alibaba' ? protocols.createAlibabaProtocol({
      region: env.ALIBABA_MODEL_STUDIO_REGION, workspaceId: env.ALIBABA_MODEL_STUDIO_WORKSPACE_ID }) : protocols.PROTOCOLS[provider]);
    if (!selectedProtocol) invalid('PROVIDER_CONTRACT_UNVERIFIED', 'Provider has no verified protocol');
    payload = selectedProtocol.mapRequest(request); target = selectedProtocol.submit(request).url;
  }
  const identity = { compilerVersion: COMPILER_VERSION, provider, model, modelVersion: request.providerSelection.modelVersion,
    capability: request.capability, target: endpoint || target, payload };
  const hash = fingerprint(identity);
  const expected = request.expectedProviderRequest;
  if (expected && (expected.compilerVersion !== COMPILER_VERSION || expected.fingerprint !== hash)) invalid('STALE_PROVIDER_PREFLIGHT',
    'Final provider payload changed after preflight; run a fresh preflight before Start');
  const summary = { compilerVersion: COMPILER_VERSION, fingerprint: hash, verifiedAt: VERIFIED_AT,
    provider, model, capability: request.capability, promptCharacters: Array.from(request.providerPrompt).length,
    promptBytes: Buffer.byteLength(request.providerPrompt), promptSha256: fingerprint(request.providerPrompt),
    promptLimitUnit: contractFor(request).promptLimitUnit || 'UNICODE_CODE_POINTS',
    promptLengthActual: textLength(request.providerPrompt, contractFor(request).promptLimitUnit),
    resolution: request.resolution, durationSeconds: request.durationSeconds,
    generatedDurationSeconds: payload.input?.num_frames && payload.input?.frames_per_second ? payload.input.num_frames / payload.input.frames_per_second : request.durationSeconds,
    payloadAspectRatio: payload.input?.aspect_ratio || payload.parameters?.ratio || payload.aspect_ratio || payload.ratio || null,
    referenceCount: [refs.firstFrame, refs.lastFrame, ...refs.characterImages, ...refs.styleImages, ...refs.referenceVideos, ...refs.referenceAudios].filter(Boolean).length,
    references: [refs.firstFrame, refs.lastFrame, ...refs.characterImages, ...refs.styleImages].filter(Boolean).map(value => ({
      sha256: crypto.createHash('sha256').update(value).digest('hex'), kind: value.startsWith('data:') ? 'INLINE_IMAGE' : 'URL' })),
    promptLimit: contractFor(request).promptLimit || LOCAL_VIDEO_PROMPT_BUDGET,
    promptLimitSource: contractFor(request).promptLimit ? 'PROVIDER_DOCUMENTATION' : 'LOCAL_OPERATIONAL_BUDGET' };
  return freeze({ ...identity, fingerprint: hash, summary });
}
function preflightVideoAsset(asset, options = {}) {
  const request = fromAsset(asset);
  if (asset.generation_requirements?.v210_reference && !request.references.firstFrame && !request.references.characterImages.length) {
    validateVideoRequest(request, { deferredReferences: true });
    return freeze({ assetId: asset.asset_id, status: 'DEFERRED_REFERENCE', compilerVersion: COMPILER_VERSION,
      ...promptMetrics(request),
      reason: 'Final payload requires the immutable reference bytes; checked again before the provider boundary' });
  }
  return freeze({ assetId: asset.asset_id, status: 'READY', ...compileVideoRequest(request, options).summary });
}
function compileAuxiliaryRequest({ asset, capability, provider, model, defaultVoice = 'alloy' }) {
  const r = asset.generation_requirements || {};
  if (!['image-generation','speech-generation'].includes(capability)
    || !['openai','openai-media','elevenlabs'].includes(provider)) invalid('PROVIDER_CONTRACT_UNVERIFIED', 'No verified auxiliary compiler for this capability/provider');
  let payload, target;
  if (capability === 'image-generation') {
    if (provider !== 'openai' && provider !== 'openai-media') invalid('PROVIDER_CONTRACT_UNVERIFIED', 'No verified image compiler for this provider');
    if (!['gpt-image-1-mini','gpt-image-1.5','gpt-image-2','gpt-image-2-2026-04-21','gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08','chatgpt-image-latest'].includes(model)) invalid('PROVIDER_CONTRACT_UNVERIFIED', 'No verified image compiler for this model');
    const prompt = [...new Set([r.prompt || asset.description, r.visual_style, r.negative_prompt && `Avoid: ${r.negative_prompt}`].filter(Boolean))].join('\n');
    assertTextLimit(prompt, 32000);
    const size = r.size || '1024x1536';
    const legacyImage = ['gpt-image-1-mini','gpt-image-1.5'].includes(model);
    if (legacyImage && !['auto','1024x1024','1024x1536','1536x1024'].includes(size)) invalid('UNSUPPORTED_IMAGE_SIZE',
      `${model} requires one of its documented fixed image sizes`);
    if (size !== 'auto') {
      const match = /^(\d+)x(\d+)$/.exec(size), w = Number(match?.[1]), h = Number(match?.[2]);
      if (!match || w % 16 || h % 16 || w < 256 || h < 256 || Math.max(w,h) > 3840 || w*h > 3840*2160 || w/h < 1/3 || w/h > 3) invalid('UNSUPPORTED_IMAGE_SIZE', 'Image size is outside the verified dimension contract');
    }
    const quality = r.quality || 'high';
    if (!['auto','low','medium','high','xhigh','max'].includes(quality)) invalid('UNSUPPORTED_IMAGE_QUALITY', 'Unsupported image quality');
    if (['xhigh','max'].includes(quality) && !/^gpt-image-2\.5-(sunburst|flare)(-2026-09-08)?$/.test(model)) {
      invalid('UNSUPPORTED_IMAGE_QUALITY', `${model} has no verified ${quality} quality setting`);
    }
    payload = { model, prompt, size, quality, n: 1 }; target = 'openai:images.generate';
  } else {
    const input = String(r.text || r.script || asset.description || '').trim();
    assertTextLimit(input, provider === 'elevenlabs' ? 5000 : 4096);
    if (provider === 'elevenlabs') {
      if (model !== 'eleven_v3') invalid('PROVIDER_CONTRACT_UNVERIFIED', 'No verified speech compiler for selected ElevenLabs model');
      const voiceId = String(r.voice_id || r.voiceId || r.voice || '').trim();
      if (!voiceId) invalid('VOICE_SELECTION_REQUIRED', 'Explicit ElevenLabs voice identity is required');
      payload = { text: input, model_id: model, ...(r.language ? { language_code: r.language } : {}),
        ...(r.voice_settings ? { voice_settings: r.voice_settings } : {}) };
      target = `elevenlabs:/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    } else {
      if (!['gpt-4o-mini-tts','gpt-4o-mini-tts-2025-03-20','gpt-4o-mini-tts-2025-12-15','tts-1','tts-1-hd'].includes(model)) invalid('PROVIDER_CONTRACT_UNVERIFIED', 'No verified speech compiler for selected OpenAI model');
      if (r.instructions && ['tts-1','tts-1-hd'].includes(model)) invalid('UNSUPPORTED_SPEECH_INSTRUCTIONS',
        `${model} does not support voice instructions; select a compatible model and review a fresh preflight`);
      if (r.instructions) assertTextLimit(r.instructions, 4096);
      payload = { model, voice: r.voice || defaultVoice, input, response_format: 'mp3',
        ...(r.instructions ? { instructions: r.instructions } : {}) }; target = 'openai:audio.speech.create';
    }
  }
  const identity = { compilerVersion: COMPILER_VERSION, provider: provider === 'openai-media' ? 'openai' : provider, model, capability, target, payload };
  const hash = fingerprint(identity);
  if (r.provider_request_preflight && (r.provider_request_preflight.compilerVersion !== COMPILER_VERSION || r.provider_request_preflight.fingerprint !== hash)) invalid('STALE_PROVIDER_PREFLIGHT', 'Auxiliary payload changed after preflight');
  return freeze({ ...identity, fingerprint: hash, summary: { compilerVersion: COMPILER_VERSION, fingerprint: hash,
    provider: identity.provider, model, capability, promptCharacters: Array.from(payload.prompt || payload.input || payload.text).length,
    size: payload.size || null, quality: payload.quality || null, outputFormat: payload.response_format || 'png' } });
}
// This collector never changes a prompt, executes a provider, or manufactures a READY certificate.
function promptMetrics(request) {
  const contract = CONTRACTS[keyOf(request)];
  const limit = contract?.promptLimit || LOCAL_VIDEO_PROMPT_BUDGET;
  return {
    promptCharacters: Array.from(request.providerPrompt || '').length,
    canonicalPromptCharacters: Array.from(request.canonicalPrompt || request.prompt || '').length,
    promptLimit: limit,
    promptLimitUnit: contract?.promptLimitUnit || 'UNICODE_CODE_POINTS',
    promptLengthActual: textLength(request.providerPrompt, contract?.promptLimitUnit),
    promptLimitSource: contract?.promptLimit ? 'PROVIDER_DOCUMENTATION' : 'LOCAL_OPERATIONAL_BUDGET',
    promptSha256: fingerprint(request.providerPrompt || ''),
    resolution: request.resolution || null, durationSeconds: request.durationSeconds ?? null,
    capability: request.capability || null,
  };
}
function collectProviderPreflight(assets, options = {}) {
  const results = [];
  for (const asset of assets) {
    const r = asset.generation_requirements || {};
    if (!['video','voice','image'].includes(asset.kind) || (asset.kind !== 'video' && r.provider === 'operator-upload')) continue;
    const context = { assetId: asset.asset_id, kind: asset.kind, provider: r.provider_selection?.provider || r.provider || null,
      model: r.provider_selection?.model || r.model || null };
    let metrics = {};
    try {
      if (asset.kind === 'video') metrics = promptMetrics(fromAsset(asset));
      const summary = asset.kind === 'video' ? preflightVideoAsset(asset, options)
        : { assetId: asset.asset_id, status: 'READY', ...compileAuxiliaryRequest({asset,
          provider: r.provider, model: r.model, capability: asset.kind === 'image' ? 'image-generation' : 'speech-generation'}).summary };
      results.push({ ...context, ...metrics, ...summary });
    } catch (error) {
      // Only structured, local compiler errors belong in operator diagnostics.
      // Unexpected programming/provider errors are not relabeled as input failures.
      if (!error?.code || (error.details?.operation !== 'LOCAL_INPUT_VALIDATION' && error.name !== 'CanonicalMediaRequestError')) throw error;
      results.push({ ...context, ...metrics, status: 'BLOCKED', code: error.code, message: error.message,
        ...(Number.isFinite(error.details?.actual) ? { actual: error.details.actual } : {}),
        ...(Number.isFinite(error.details?.maximum) ? { maximum: error.details.maximum } : {}),
        ...(typeof error.details?.unit === 'string' ? { unit: error.details.unit } : {}),
        ...(typeof error.details?.source === 'string' ? { source: error.details.source } : {}) });
    }
  }
  return freeze(results);
}
function assertProviderPreflight(results) {
  const failures = results.filter(result => result.status === 'BLOCKED');
  if (!failures.length) return results;
  const describe = result => `${result.assetId} (${result.model}): ${result.code}` +
    (result.actual != null && result.maximum != null ? ` ${result.actual}/${result.maximum}` : ` ${result.message}`);
  invalid('PROVIDER_PREFLIGHT_FAILED',
    `Provider preflight blocked for ${failures.length}/${results.length} checked assets. ${failures.map(describe).join(' | ')}. No provider calls were made.`,
    { providerExecutions: 0, providerPreflight: { checkedAssets: results.length, blockedAssets: failures.length, results } });
}
function preflightProviderAssets(assets, options = {}) {
  return assertProviderPreflight(collectProviderPreflight(assets, options));
}
module.exports = { promptMetrics, collectProviderPreflight, assertProviderPreflight, preflightProviderAssets, COMPILER_VERSION, VERIFIED_AT, CONTRACTS, LOCAL_VIDEO_PROMPT_BUDGET,
  compileAuxiliaryRequest, assertTextLimit, compileVideoRequest, preflightVideoAsset, validateVideoRequest, invalid };
