'use strict';

const { CAPABILITIES: C } = require('./capabilities');

const ratioPixels = (ratio) => ratio === '9:16' ? '720:1280' : '1280:720';
const commonHeaders = (authorization) => ({ Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' });
const state = (value, states) => states[String(value || '').toLowerCase()] || 'PENDING';

const PROTOCOLS = Object.freeze({
  fal: {
    id: 'fal', adapterFamily: 'fal-video', models: ['bytedance/seedance-2.0/text-to-video'],
    capabilities: [C.TEXT_TO_VIDEO],
    headers: (key) => commonHeaders(`Key ${key}`), submit: (request) => ({ url: `https://queue.fal.run/${request.providerSelection.model}` }),
    status: (id, model) => ({ url: `https://queue.fal.run/${model}/requests/${encodeURIComponent(id)}/status` }),
    result: (id, model, body) => body?.video ? { body } : ({ url: `https://queue.fal.run/${model}/requests/${encodeURIComponent(id)}` }),
    requestId: (body) => body.request_id, state: (body) => state(body.status, { in_queue: 'PENDING', in_progress: 'RUNNING', completed: body.error ? 'FAILED' : 'SUCCEEDED' }),
    mapRequest: (request) => ({ prompt: request.providerPrompt, resolution: request.resolution,
      duration: String(request.durationSeconds || request.resolvedSettings.duration || '5'), aspect_ratio: request.aspectRatio,
      generate_audio: request.audio.requested, ...(request.seed == null ? {} : { seed: request.seed }),
      ...(request.resolvedSettings.bitrateMode ? { bitrate_mode: request.resolvedSettings.bitrateMode } : {}),
      ...(request.references.characterImages.length || request.references.styleImages.length || request.references.referenceVideos.length
        ? { reference_urls: [...request.references.characterImages, ...request.references.styleImages, ...request.references.referenceVideos] } : {}) }),
    outputUrl: (body) => body.video?.url || body.data?.video?.url,
  },
  runway: {
    id: 'runway', adapterFamily: 'runway-video', models: ['gen4.5'], capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO],
    headers: (key) => ({ ...commonHeaders(`Bearer ${key}`), 'X-Runway-Version': '2024-11-06' }),
    submit: (request) => ({ url: `https://api.dev.runwayml.com/v1/${request.capability === C.IMAGE_TO_VIDEO ? 'image_to_video' : 'text_to_video'}` }),
    status: (id) => ({ url: `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(id)}` }),
    result: (_id, _model, body) => ({ body }), requestId: (body) => body.id,
    state: (body) => state(body.status, { pending: 'PENDING', throttled: 'PENDING', running: 'RUNNING', succeeded: 'SUCCEEDED', failed: 'FAILED', canceled: 'CANCELED' }),
    mapRequest: (request) => ({ model: request.providerSelection.model, promptText: request.providerPrompt,
      ratio: ratioPixels(request.aspectRatio), duration: request.durationSeconds || 5,
      ...(request.capability === C.IMAGE_TO_VIDEO ? { promptImage: request.references.firstFrame } : {}) }),
    outputUrl: (body) => Array.isArray(body.output) ? body.output[0] : null,
  },
  google: {
    id: 'google', adapterFamily: 'google-veo', models: ['veo-3.1-generate-preview'],
    capabilities: [C.TEXT_TO_VIDEO],
    headers: (key) => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }),
    downloadHeaders: (key) => ({ 'x-goog-api-key': key }),
    submit: (request) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models/${request.providerSelection.model}:predictLongRunning` }),
    status: (id) => ({ url: `https://generativelanguage.googleapis.com/v1beta/${id}` }),
    result: (_id, _model, body) => ({ body }), requestId: (body) => body.name,
    state: (body) => body.error ? 'FAILED' : body.done === true ? 'SUCCEEDED' : 'PENDING',
    mapRequest: (request) => ({ instances: [{ prompt: request.providerPrompt }], parameters: {
      aspectRatio: request.aspectRatio, resolution: request.resolution,
      durationSeconds: request.durationSeconds || 8, ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}) } }),
    outputUrl: (body) => body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri,
  },
  luma: {
    id: 'luma', adapterFamily: 'luma-video', models: ['ray-2'], capabilities: [C.TEXT_TO_VIDEO,C.IMAGE_TO_VIDEO],
    headers: (key) => commonHeaders(`Bearer ${key}`),
    submit: () => ({ url: 'https://api.lumalabs.ai/dream-machine/v1/generations/video' }),
    status: (id) => ({ url: `https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(id)}` }),
    result: (_id, _model, body) => ({ body }), requestId: (body) => body.id,
    state: (body) => state(body.state, { queued: 'PENDING', dreaming: 'RUNNING', completed: 'SUCCEEDED', failed: 'FAILED' }),
    mapRequest: (request) => ({ generation_type: 'video', model: request.providerSelection.model, prompt: request.providerPrompt,
      aspect_ratio: request.aspectRatio, resolution: request.resolution,
      duration: request.resolvedSettings.duration || `${request.durationSeconds || 5}s`, loop: false,
      ...(request.references.firstFrame || request.references.lastFrame ? { keyframes: {
        ...(request.references.firstFrame ? { frame0: { type: 'image', url: request.references.firstFrame } } : {}),
        ...(request.references.lastFrame ? { frame1: { type: 'image', url: request.references.lastFrame } } : {}) } } : {}) }),
    outputUrl: (body) => body.assets?.video,
  },
});

module.exports = { PROTOCOLS };
