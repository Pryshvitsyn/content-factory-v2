'use strict';

const { ProviderError, assertProviderResult } = require('./provider-contract');

/**
 * NVIDIA video adapter.
 *
 * Provider-neutral core stays unaware of NVIDIA request/response shapes.
 * The endpoint is configurable because NVIDIA exposes different video
 * deployments (for example Cosmos NIM uses /v1/infer, while other
 * OpenAI-compatible deployments expose /v1/videos/generations).
 */
class NvidiaVideoAdapter {
  constructor({
    apiKey = process.env.NVIDIA_API_KEY,
    baseURL = process.env.NVIDIA_VIDEO_BASE_URL || process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com',
    endpoint = process.env.NVIDIA_VIDEO_ENDPOINT || '/v1/infer',
    model = process.env.NVIDIA_VIDEO_MODEL || 'nvidia/cosmos3-nano',
    fetchImpl = global.fetch,
  } = {}) {
    if (!fetchImpl) throw new Error('NVIDIA video adapter requires fetch');
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.endpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    this.model = model;
    this.fetch = fetchImpl;
  }

  supports({ capability } = {}) {
    return capability === 'video-generation';
  }

  modelFor({ capability } = {}) {
    return this.supports({ capability }) ? this.model : null;
  }

  async healthCheck() {
    if (!this.apiKey) return true;
    const url = `${this.baseURL}/v1/health/ready`;
    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate({
    prompt,
    model = this.model,
    image,
    imageUrl,
    seed,
    resolution,
    numOutputFrames,
    fps,
    steps,
    guidanceScale,
    negativePrompt,
    ...extra
  } = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new ProviderError('NVIDIA video generation requires a prompt', { provider: 'nvidia', model });
    }
    if (!this.apiKey) {
      throw new ProviderError('NVIDIA_API_KEY is required for video generation', { provider: 'nvidia', model });
    }

    const body = {
      model,
      prompt,
      ...extra,
    };
    if (image != null) body.image = image;
    if (imageUrl != null) body.image = imageUrl;
    if (seed != null) body.seed = seed;
    if (resolution != null) body.resolution = resolution;
    if (numOutputFrames != null) body.num_output_frames = numOutputFrames;
    if (fps != null) body.fps = fps;
    if (steps != null) body.steps = steps;
    if (guidanceScale != null) body.guidance_scale = guidanceScale;
    if (negativePrompt != null) body.negative_prompt = negativePrompt;

    let response;
    try {
      response = await this.fetch(`${this.baseURL}${this.endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ProviderError('NVIDIA video request failed', { provider: 'nvidia', model, cause });
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (cause) {
      throw new ProviderError('NVIDIA video endpoint returned invalid JSON', { provider: 'nvidia', model, cause });
    }

    if (!response.ok) {
      throw new ProviderError(`NVIDIA video request failed with HTTP ${response.status}: ${payload?.detail || payload?.message || text}`, {
        provider: 'nvidia',
        model,
        cause: payload,
      });
    }

    const b64Video = payload.b64_video || payload.video?.b64_video || payload.data?.[0]?.b64_video || payload.data?.[0]?.b64_json;
    const mediaUrl = payload.url || payload.video_url || payload.video?.url || payload.data?.[0]?.url || null;

    if (!b64Video && !mediaUrl) {
      throw new ProviderError('NVIDIA video response contains neither b64_video nor a video URL', {
        provider: 'nvidia',
        model,
        cause: payload,
      });
    }

    const result = {
      provider: 'nvidia',
      model,
      capability: 'video-generation',
      output: b64Video ? Buffer.from(b64Video, 'base64') : null,
      mediaUrl,
      contentType: 'video/mp4',
      requestId: payload.id || payload.request_id || null,
      usage: payload.usage || null,
      raw: payload,
      provenance: {
        provider: 'nvidia',
        model,
        endpoint: this.endpoint,
      },
    };

    return assertProviderResult(result);
  }
}

module.exports = { NvidiaVideoAdapter };
