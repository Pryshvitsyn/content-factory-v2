'use strict';

const { ReplicateWanVideoAdapter, parseGenerationPrompt } = require('./replicate-wan-video-adapter');
const { ProviderError } = require('./provider-contract');
const { compatible } = require('../v2.10.2/reference-geometry');
const crypto = require('node:crypto');

function requestOf(options) {
  const parsed = options.canonicalRequest
    ? { prompt: options.canonicalRequest.providerPrompt || options.canonicalRequest.prompt, requirements: {} }
    : parseGenerationPrompt(options.prompt);
  return { parsed, request: options.canonicalRequest || null, requirements: parsed.requirements || {} };
}

function buildWan3Input({ prompt, resolution = '720p', aspectRatio = '9:16', duration = 5,
  image = null, negativePrompt = '', enablePromptExpansion = true, seed } = {}) {
  if (!String(prompt || '').trim()) throw new ProviderError('Wan 3 requires a prompt', { provider: 'replicate', model: 'alibaba/wan-3' });
  if (!['480p','720p','1080p'].includes(resolution)) throw new ProviderError('Wan 3 resolution is unsupported', { provider: 'replicate', model: 'alibaba/wan-3' });
  if (!Number.isInteger(duration) || duration < 2 || duration > 30) throw new ProviderError('Wan 3 duration must be 2-30 seconds', { provider: 'replicate', model: 'alibaba/wan-3' });
  return { prompt: prompt.trim(), resolution, duration, ...(image ? { image } : { aspect_ratio: aspectRatio }),
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}), enable_prompt_expansion: Boolean(enablePromptExpansion),
    ...(seed == null ? {} : { seed }) };
}

function buildWan27R2VInput({ prompt, resolution = '720p', aspectRatio = '9:16', duration = 5, shotType = 'single', referenceImages = [], referenceVideos = [], negativePrompt = '', seed } = {}) {
  if (!String(prompt || '').trim()) throw new ProviderError('Wan 2.7 R2V requires a prompt', { provider: 'replicate', model: 'wan-video/wan-2.7-r2v' });
  if (!Number.isInteger(duration) || duration < 2 || duration > 10) throw new ProviderError('Wan 2.7 R2V duration must be 2-10 seconds', { provider: 'replicate', model: 'wan-video/wan-2.7-r2v' });
  if (!['720p','1080p'].includes(resolution) || !['16:9','9:16','1:1','4:3','3:4'].includes(aspectRatio) || shotType !== 'single') throw new ProviderError('Wan 2.7 R2V settings are unsupported', { provider: 'replicate', model: 'wan-video/wan-2.7-r2v' });
  if (!Array.isArray(referenceImages) || !referenceImages.length) throw new ProviderError('Wan 2.7 R2V requires at least one reference image', { provider: 'replicate', model: 'wan-video/wan-2.7-r2v' });
  return { prompt: prompt.trim(), duration, shot_type: shotType, resolution, aspect_ratio: aspectRatio, reference_images: referenceImages, reference_videos: referenceVideos, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}), ...(seed == null ? {} : { seed }) };
}

function assertWan3ReferenceGeometry(request, refs, aspectRatio) {
  if (!refs.firstFrame) return;
  const evidence = request?.referenceGeometry;
  const actual = evidence && { width: Number(evidence.referenceWidth), height: Number(evidence.referenceHeight),
    aspectRatio: Number(evidence.referenceAspectRatio) };
  const encoded = /^data:[^;,]+;base64,(.+)$/s.exec(String(refs.firstFrame));
  const suppliedHash = encoded ? crypto.createHash('sha256').update(Buffer.from(encoded[1], 'base64')).digest('hex') : null;
  if (request?.capability !== 'IMAGE_TO_VIDEO' || !actual?.width || !actual?.height
    || !compatible(actual, aspectRatio) || evidence.expectedAspectRatio !== aspectRatio
    || !evidence.referenceHash || suppliedHash !== evidence.referenceHash) {
    const error = new ProviderError('Wan 3 IMAGE_TO_VIDEO requires a locally decoded first frame matching canonical geometry', {
      provider: 'replicate', model: 'alibaba/wan-3' });
    error.code = 'REFERENCE_GEOMETRY_MISMATCH';
    error.details = { capability: request?.capability, expectedAspectRatio: aspectRatio,
      referenceGeometry: evidence || null, suppliedReferenceHash: suppliedHash };
    throw error;
  }
}

function buildSeedance25Input({ prompt, resolution = '720p', aspectRatio = '9:16', duration = 5,
  image = null, lastFrameImage = null, referenceImages = [], referenceVideos = [], referenceAudios = [],
  generateAudio = false, watermark = false, seed } = {}) {
  if (!String(prompt || '').trim()) throw new ProviderError('Seedance 2.5 requires a prompt', { provider: 'replicate', model: 'bytedance/seedance-2.5' });
  if (!Number.isInteger(duration) || duration < 1 || duration > 30) throw new ProviderError('Seedance 2.5 duration must be 1-30 seconds', { provider: 'replicate', model: 'bytedance/seedance-2.5' });
  if ((image || lastFrameImage) && (referenceImages.length || referenceVideos.length || referenceAudios.length)) {
    throw new ProviderError('Seedance first/last frames cannot be combined with reference media', { provider: 'replicate', model: 'bytedance/seedance-2.5' });
  }
  if (referenceImages.length > 30 || referenceVideos.length > 10 || referenceAudios.length > 10) {
    throw new ProviderError('Seedance reference media limit exceeded', { provider: 'replicate', model: 'bytedance/seedance-2.5' });
  }
  return { prompt: prompt.trim(), resolution, duration, aspect_ratio: aspectRatio, generate_audio: Boolean(generateAudio),
    watermark: Boolean(watermark), output_format: 'mp4', ...(image ? { image } : {}),
    ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}), ...(referenceImages.length ? { reference_images: referenceImages } : {}),
    ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}), ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
    ...(seed == null ? {} : { seed }) };
}

class ReplicateUniversalVideoAdapter extends ReplicateWanVideoAdapter {
  constructor({ family, ...options } = {}) { super(options); this.family = family; }
  supports({ capability, model } = {}) {
    const supported = this.family === 'WAN_3' ? ['video-generation','TEXT_TO_VIDEO','IMAGE_TO_VIDEO']
      : this.family === 'WAN_2_7_R2V' ? ['REFERENCE_TO_VIDEO']
      : ['video-generation','TEXT_TO_VIDEO','IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO','VIDEO_TO_VIDEO','VIDEO_EXTENSION'];
    return supported.includes(capability) && (!model || model === this.model);
  }
  async generate(options = {}) {
    const supportRequest = { capability: options.capability || options.canonicalRequest?.capability,
      model: options.model || options.canonicalRequest?.providerSelection?.model };
    if (!this.supports(supportRequest)) throw new ProviderError(`Replicate ${this.family} does not support this request`, { provider: 'replicate', model: this.model });
    const { parsed, request, requirements } = requestOf(options);
    const resolved = request?.resolvedSettings || requirements.resolved_settings || {};
    const common = { prompt: request?.providerPrompt || parsed.prompt, resolution: request?.resolution || resolved.resolution || requirements.resolution || '720p',
      aspectRatio: request?.aspectRatio || requirements.aspect_ratio || '9:16', duration: request?.durationSeconds || Number(resolved.duration || requirements.duration || 5), seed: request?.seed ?? requirements.seed };
    const refs = request?.references || {};
    if (this.family === 'WAN_3') assertWan3ReferenceGeometry(request, refs, common.aspectRatio);
    const input = this.family === 'WAN_3' ? buildWan3Input({ ...common, image: refs.firstFrame || null,
      negativePrompt: request?.negativePrompt || requirements.negative_prompt,
      enablePromptExpansion: resolved.enablePromptExpansion ?? requirements.enable_prompt_expansion ?? true })
      : this.family === 'WAN_2_7_R2V' ? buildWan27R2VInput({ ...common, shotType: request?.shotType || resolved.shotType || 'single', referenceImages: refs.referenceImages || [], referenceVideos: refs.referenceVideos || [], negativePrompt: request?.negativePrompt || requirements.negative_prompt })
      : buildSeedance25Input({ ...common, image: refs.firstFrame || null, lastFrameImage: refs.lastFrame || null,
        referenceImages: [...(refs.characterImages || []), ...(refs.styleImages || [])], referenceVideos: refs.referenceVideos || [],
        referenceAudios: refs.referenceAudios || [], generateAudio: request?.audio?.requested ?? resolved.generateAudio ?? false,
        watermark: resolved.watermark ?? false });
    const enrich = (result) => Object.freeze({ ...result, provenance: Object.freeze({ ...(result.provenance || {}),
      capability: request?.capability || supportRequest.capability, requestedAspectRatio: common.aspectRatio,
      framingInheritedFrom: this.family === 'WAN_2_7_R2V' ? 'VERIFIED_REFERENCE_IMAGES' : refs.firstFrame ? 'VERIFIED_FIRST_FRAME' : 'ASPECT_RATIO_PARAMETER',
      referenceGeometry: request?.referenceGeometry || null, resolvedSettings: resolved }) });
    if (!options.idempotencyKey) return enrich(await this.runPrediction({ input, idempotencyKey: null, onProviderRequest: options.onProviderRequest }));
    const identity = JSON.stringify(input);
    if (this.inflight.has(options.idempotencyKey)) {
      const existing = this.inflight.get(options.idempotencyKey);
      if (existing.operationIdentity !== identity) throw new ProviderError('Replicate idempotency conflict', { provider: 'replicate', model: this.model });
      return existing.promise;
    }
    const operation = this.runPrediction({ input, idempotencyKey: options.idempotencyKey,
      onProviderRequest: options.onProviderRequest }).then(enrich);
    this.inflight.set(options.idempotencyKey, { operationIdentity: identity, promise: operation });
    try { return await operation; } finally { this.inflight.delete(options.idempotencyKey); }
  }
}

module.exports = { ReplicateUniversalVideoAdapter, assertWan3ReferenceGeometry, buildWan3Input, buildWan27R2VInput, buildSeedance25Input };
