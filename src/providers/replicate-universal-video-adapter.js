'use strict';

const { ReplicateWanVideoAdapter, parseGenerationPrompt } = require('./replicate-wan-video-adapter');
const { ProviderError } = require('./provider-contract');

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
    const supported = ['video-generation','TEXT_TO_VIDEO','IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO','VIDEO_TO_VIDEO','VIDEO_EXTENSION'];
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
    const input = this.family === 'WAN_3' ? buildWan3Input({ ...common, image: refs.firstFrame || null,
      negativePrompt: request?.negativePrompt || requirements.negative_prompt,
      enablePromptExpansion: resolved.enablePromptExpansion ?? requirements.enable_prompt_expansion ?? true })
      : buildSeedance25Input({ ...common, image: refs.firstFrame || null, lastFrameImage: refs.lastFrame || null,
        referenceImages: [...(refs.characterImages || []), ...(refs.styleImages || [])], referenceVideos: refs.referenceVideos || [],
        referenceAudios: refs.referenceAudios || [], generateAudio: request?.audio?.requested ?? resolved.generateAudio ?? false,
        watermark: resolved.watermark ?? false });
    if (!options.idempotencyKey) return this.runPrediction({ input, idempotencyKey: null, onProviderRequest: options.onProviderRequest });
    const identity = JSON.stringify(input);
    if (this.inflight.has(options.idempotencyKey)) {
      const existing = this.inflight.get(options.idempotencyKey);
      if (existing.operationIdentity !== identity) throw new ProviderError('Replicate idempotency conflict', { provider: 'replicate', model: this.model });
      return existing.promise;
    }
    const operation = this.runPrediction({ input, idempotencyKey: options.idempotencyKey, onProviderRequest: options.onProviderRequest });
    this.inflight.set(options.idempotencyKey, { operationIdentity: identity, promise: operation });
    try { return await operation; } finally { this.inflight.delete(options.idempotencyKey); }
  }
}

module.exports = { ReplicateUniversalVideoAdapter, buildWan3Input, buildSeedance25Input };
