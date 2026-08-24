'use strict';

const MPT_TASK_STATE = Object.freeze({ FAILED: -1, COMPLETE: 1, PROCESSING: 4 });

class MoneyPrinterTurboError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'MoneyPrinterTurboError';
    this.code = code;
    this.details = details;
  }
}

function required(name, value) {
  if (value === undefined || value === null || value === '') throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', `${name} is required`);
  return value;
}

function finite(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', `${name} must be finite`);
  return parsed;
}

function positiveInteger(name, value, fallback) {
  const parsed = Math.round(finite(name, value, fallback));
  if (parsed <= 0) throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', `${name} must be a positive integer`);
  return parsed;
}

function normalizeMptRequest({ production, script, scenes, voiceover, captions, mediaPreferences, outputProfile } = {}) {
  required('production', production);
  required('script', script);
  const providerOptions = mediaPreferences?.providerOptions || {};
  const spokenCopy = String(voiceover?.text || scenes?.map((scene) => scene.dialogue_or_voiceover).filter(Boolean).join(' ') || '').trim();
  const subject = String(production.title || production.creativeConcept || script.core_message || script.hook || '').trim();
  if (!subject || !spokenCopy) throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', 'FAST render requires a subject and non-empty voiceover/script');
  if (outputProfile?.aspectRatio !== '9:16') throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', 'MoneyPrinterTurbo FAST certification currently supports 9:16');
  const concatMode = providerOptions.concat_mode || 'sequential';
  if (!['random', 'sequential'].includes(concatMode)) throw new MoneyPrinterTurboError('MPT_REQUEST_INVALID', 'concat_mode must be random or sequential');
  return Object.freeze({
    video_subject: subject,
    video_script: spokenCopy,
    ...(providerOptions.video_terms ? { video_terms: providerOptions.video_terms } : {}),
    video_aspect: outputProfile.aspectRatio,
    video_concat_mode: concatMode,
    video_transition_mode: providerOptions.transition_mode ?? null,
    video_clip_duration: positiveInteger('clip_duration_seconds', providerOptions.clip_duration_seconds, 5),
    video_clip_speed: 1,
    match_materials_to_script: providerOptions.match_materials_to_script === true,
    video_count: 1,
    video_source: required('mediaPreferences.mediaSource', mediaPreferences?.mediaSource),
    video_language: voiceover?.language || 'en',
    voice_name: providerOptions.voice_name || voiceover?.voice || '',
    voice_volume: finite('voice_volume', providerOptions.voice_volume, 1),
    voice_rate: finite('voice_rate', providerOptions.voice_rate, 1),
    bgm_type: mediaPreferences?.music ? 'random' : '',
    bgm_volume: mediaPreferences?.music ? finite('bgm_volume', providerOptions.bgm_volume, 0.15) : 0,
    subtitle_enabled: captions?.enabled === true,
    subtitle_position: providerOptions.subtitle_position || 'bottom',
    font_name: providerOptions.font_name || 'STHeitiMedium.ttc',
    font_size: positiveInteger('font_size', providerOptions.font_size, 60),
    text_fore_color: providerOptions.text_fore_color || '#FFFFFF',
    stroke_color: providerOptions.stroke_color || '#000000',
    stroke_width: finite('stroke_width', providerOptions.stroke_width, 1.5),
    n_threads: positiveInteger('threads', providerOptions.threads, 2),
    paragraph_number: Math.max(1, Math.min(10, scenes?.length || 1)),
  });
}

class MoneyPrinterTurboAdapter {
  constructor({ config, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
    if (!config?.baseUrl) throw new Error('MoneyPrinterTurbo config is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.config = config;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.now = now;
    this.baseUrl = new URL(config.baseUrl);
  }

  headers(requestId = null) {
    return Object.freeze({
      Accept: 'application/json',
      ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {}),
      ...(requestId ? { 'x-task-id': requestId } : {}),
    });
  }

  async request(pathname, { method = 'GET', body = null, expectJson = true, requestId = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetch(new URL(pathname, this.baseUrl), {
        method,
        headers: { ...this.headers(requestId), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!response?.ok) throw new MoneyPrinterTurboError('MPT_SERVICE_ERROR', `MoneyPrinterTurbo returned HTTP ${response?.status || 'unknown'}`);
      if (!expectJson) return response;
      let payload;
      try { payload = await response.json(); } catch { throw new MoneyPrinterTurboError('MPT_RESPONSE_INVALID', 'MoneyPrinterTurbo returned malformed JSON'); }
      if (!payload || payload.status !== 200 || !payload.data || typeof payload.data !== 'object') {
        throw new MoneyPrinterTurboError('MPT_RESPONSE_INVALID', 'MoneyPrinterTurbo returned an invalid response envelope');
      }
      return payload.data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new MoneyPrinterTurboError('MPT_REQUEST_TIMEOUT', 'MoneyPrinterTurbo request timed out');
      if (error instanceof MoneyPrinterTurboError) throw error;
      throw new MoneyPrinterTurboError('MPT_SERVICE_UNAVAILABLE', `MoneyPrinterTurbo request failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    const configured = this.config.enabled === true && Boolean(this.config.baseUrl);
    if (!configured) return Object.freeze({ configured: false, availability: 'DISABLED' });
    if (!this.config.healthcheck) return Object.freeze({ configured: true, availability: 'NOT_PROBED' });
    try {
      await this.request('/openapi.json', { expectJson: false });
      return Object.freeze({ configured: true, availability: 'AVAILABLE' });
    } catch (error) {
      return Object.freeze({ configured: true, availability: 'UNAVAILABLE', errorCode: error.code || 'MPT_HEALTH_FAILED' });
    }
  }

  validate(request) {
    normalizeMptRequest(request);
    return Object.freeze({ renderer: 'moneyprinterturbo', mode: 'FAST', version: this.config.version,
      output: Object.freeze({ aspectRatio: request.outputProfile.aspectRatio,
        width: request.outputProfile.width, height: request.outputProfile.height,
        durationSeconds: request.outputProfile.durationSeconds,
        captions: request.captions?.enabled === true, music: request.mediaPreferences?.music === true }) });
  }

  async render(request, { onAccepted = null, onStatus = null } = {}) {
    const body = normalizeMptRequest(request);
    const accepted = await this.request('/api/v1/videos', { method: 'POST', body });
    const taskId = String(accepted.task_id || '').trim();
    if (!taskId) throw new MoneyPrinterTurboError('MPT_RESPONSE_INVALID', 'MoneyPrinterTurbo did not return task_id');
    await onAccepted?.({ requestId: taskId, status: 'accepted' });
    return this.poll({ taskId, request, onStatus });
  }

  async recover({ requestId, request, onStatus = null } = {}) {
    const taskId = String(required('requestId', requestId)).trim();
    return this.poll({ taskId, request, onStatus });
  }

  async poll({ taskId, request, onStatus }) {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.config.maxWaitMs) {
      const task = await this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { requestId: taskId });
      if (String(task.task_id || '') !== taskId || !Object.values(MPT_TASK_STATE).includes(Number(task.state))) {
        throw new MoneyPrinterTurboError('MPT_RESPONSE_INVALID', 'MoneyPrinterTurbo returned malformed task state');
      }
      if (task.cross_post_state !== undefined && task.cross_post_state !== null) {
        throw new MoneyPrinterTurboError('MPT_PUBLICATION_POLICY_VIOLATION',
          'MoneyPrinterTurbo reported cross-post state; automatic publication must be disabled', { requestId: taskId });
      }
      const status = Number(task.state) === MPT_TASK_STATE.PROCESSING ? 'processing'
        : Number(task.state) === MPT_TASK_STATE.FAILED ? 'failed' : 'completed';
      await onStatus?.({ requestId: taskId, status, progress: Number(task.progress || 0) });
      if (Number(task.state) === MPT_TASK_STATE.FAILED) {
        throw new MoneyPrinterTurboError('MPT_TASK_FAILED', `MoneyPrinterTurbo task failed at ${task.failed_stage || 'unknown'}: ${task.error || 'unknown error'}`, {
          requestId: taskId, failedStage: task.failed_stage || null,
        });
      }
      if (Number(task.state) === MPT_TASK_STATE.COMPLETE) {
        const outputUrl = [...(task.videos || []), ...(task.combined_videos || [])].find((value) => typeof value === 'string' && value.trim());
        if (!outputUrl) throw new MoneyPrinterTurboError('MPT_RESPONSE_INVALID', 'Completed MoneyPrinterTurbo task has no video output');
        const output = await this.download(outputUrl, taskId);
        return Object.freeze({
          renderer: 'moneyprinterturbo', mode: 'FAST', requestId: taskId, status: 'completed',
          output: output.bytes, contentType: output.contentType, durationMs: null,
          width: request.outputProfile?.width || 1080, height: request.outputProfile?.height || 1920,
          videoCodec: null, audioCodec: null,
          provenance: Object.freeze({ renderer: 'moneyprinterturbo', version: this.config.version,
            taskId, outputPath: output.path, cost: Object.freeze({ status: 'unknown', amount: null, currency: null }) }),
        });
      }
      await this.sleep(this.config.pollIntervalMs);
    }
    throw new MoneyPrinterTurboError('MPT_TASK_TIMEOUT', 'MoneyPrinterTurbo task did not reach a terminal state before max wait', { requestId: taskId });
  }

  outputUrl(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\\') || value.includes('..')) {
      throw new MoneyPrinterTurboError('MPT_OUTPUT_URL_REJECTED', 'MoneyPrinterTurbo returned an unsafe output URL');
    }
    const resolved = new URL(value, this.baseUrl);
    if (resolved.origin !== this.baseUrl.origin || !['/tasks/', '/api/v1/download/', '/api/v1/stream/'].some((prefix) => resolved.pathname.startsWith(prefix))) {
      throw new MoneyPrinterTurboError('MPT_OUTPUT_URL_REJECTED', 'MoneyPrinterTurbo output must be a same-origin task/download URL');
    }
    return resolved;
  }

  async download(value, requestId) {
    const url = this.outputUrl(value);
    const response = await this.request(url.pathname + url.search, { expectJson: false, requestId });
    const contentType = String(response.headers?.get?.('content-type') || 'video/mp4').split(';')[0].trim();
    if (!contentType.startsWith('video/')) throw new MoneyPrinterTurboError('MPT_OUTPUT_INVALID', 'MoneyPrinterTurbo output is not a video');
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > this.config.maxOutputBytes) throw new MoneyPrinterTurboError('MPT_OUTPUT_TOO_LARGE', 'MoneyPrinterTurbo output exceeds configured byte limit');
    const chunks = [];
    let size = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > this.config.maxOutputBytes) {
          await reader.cancel();
          throw new MoneyPrinterTurboError('MPT_OUTPUT_TOO_LARGE', 'MoneyPrinterTurbo output exceeds configured byte limit');
        }
        chunks.push(Buffer.from(chunk));
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      size = bytes.length;
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw new MoneyPrinterTurboError('MPT_OUTPUT_INVALID', 'MoneyPrinterTurbo output is empty');
    return { bytes, contentType, path: url.pathname };
  }
}

module.exports = {
  MoneyPrinterTurboAdapter,
  MoneyPrinterTurboError,
  MPT_TASK_STATE,
  normalizeMptRequest,
};
