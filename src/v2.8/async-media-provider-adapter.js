'use strict';

const { fromAsset, createCanonicalMediaRequest } = require('./canonical-media-request');
const { normalizeCapability: canonicalCapability } = require('./capabilities');
const { UniversalMediaProviderAdapter } = require('./provider-adapter-contract');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AsyncProviderError extends Error {
  constructor(provider, code, message, details = null) {
    super(message); this.name = 'AsyncProviderError'; this.provider = provider; this.code = code; this.details = details;
  }
}

function parseLegacyPrompt(prompt, model, provider) {
  let parsed = null;
  try { parsed = JSON.parse(prompt); } catch { parsed = null; }
  if (parsed?.asset_id) {
    return fromAsset({ asset_id: parsed.asset_id, kind: parsed.kind || 'video', description: parsed.description,
      generation_requirements: { ...(parsed.generation_requirements || {}), provider, model } });
  }
  return createCanonicalMediaRequest({ capability: 'TEXT_TO_VIDEO', prompt,
    providerSelection: { provider, model, profile: 'STANDARD' } });
}

class AsyncMediaProviderAdapter extends UniversalMediaProviderAdapter {
  constructor({ protocol, credential, fetchImpl = global.fetch, pollIntervalMs = 2000, timeoutMs = 15 * 60 * 1000,
    sleep = wait, now = Date.now } = {}) {
    super();
    if (!protocol?.id || typeof protocol.submit !== 'function' || typeof protocol.status !== 'function'
      || typeof protocol.result !== 'function' || typeof protocol.mapRequest !== 'function') {
      throw new Error('A fixed async provider protocol is required');
    }
    if (!fetchImpl) throw new Error('fetch is required');
    this.protocol = protocol; this.provider = protocol.id; this.credential = credential;
    this.fetch = fetchImpl; this.pollIntervalMs = pollIntervalMs; this.timeoutMs = timeoutMs;
    this.sleep = sleep; this.now = now;
  }
  supports({ capability, model } = {}) {
    let normalized;
    try { normalized = canonicalCapability(capability); } catch { return false; }
    return (!model || this.protocol.models.includes(model)) && this.protocol.capabilities.includes(normalized);
  }
  modelFor() { return this.protocol.models[0] || null; }
  async healthCheck() { return Boolean(this.credential); }
  validate(request) {
    if (!request || !this.supports({ capability: request.capability, model: request.providerSelection?.model })) {
      throw new AsyncProviderError(this.provider, 'CAPABILITY_UNSUPPORTED', `${this.provider} adapter does not support the selected request`);
    }
    return request;
  }
  estimate() { return Object.freeze({ costStatus: 'UNKNOWN', amount: null }); }
  headers() { return this.protocol.headers(this.credential); }
  async requestJson(url, options = {}) {
    let response;
    try { response = await this.fetch(url, options); }
    catch (cause) { throw new AsyncProviderError(this.provider, 'PROVIDER_NETWORK_ERROR', `${this.provider} request failed`, { cause }); }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : {}; }
    catch { throw new AsyncProviderError(this.provider, 'PROVIDER_MALFORMED_RESPONSE', `${this.provider} returned invalid JSON`); }
    if (!response.ok) throw new AsyncProviderError(this.provider, 'PROVIDER_HTTP_ERROR', `${this.provider} returned HTTP ${response.status}`, { status: response.status, body });
    return body;
  }
  async submit(request) {
    if (!this.credential) throw new AsyncProviderError(this.provider, 'CREDENTIALS_MISSING', `${this.provider} credentials are missing`);
    const descriptor = this.protocol.submit(request);
    const body = await this.requestJson(descriptor.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(this.protocol.mapRequest(request)) });
    const requestId = this.protocol.requestId(body);
    if (!requestId) throw new AsyncProviderError(this.provider, 'PROVIDER_REQUEST_ID_MISSING', `${this.provider} did not return a request ID`);
    return Object.freeze({ requestId, body });
  }
  async status(externalRequestId, model = this.modelFor()) {
    const descriptor = this.protocol.status(externalRequestId, model);
    const body = await this.requestJson(descriptor.url, { method: 'GET', headers: this.headers() });
    return Object.freeze({ state: this.protocol.state(body), body });
  }
  async download(result) {
    const mediaUrl = this.protocol.outputUrl(result);
    if (!mediaUrl) throw new AsyncProviderError(this.provider, 'PROVIDER_OUTPUT_MISSING', `${this.provider} completed without a video URL`);
    const response = await this.fetch(mediaUrl, { method: 'GET', headers: this.protocol.downloadHeaders?.(this.credential) || {} });
    if (!response.ok) throw new AsyncProviderError(this.provider, 'PROVIDER_DOWNLOAD_FAILED', `${this.provider} media download returned HTTP ${response.status}`);
    const output = Buffer.from(await response.arrayBuffer());
    if (!output.length) throw new AsyncProviderError(this.provider, 'PROVIDER_DOWNLOAD_EMPTY', `${this.provider} returned empty media`);
    return { mediaUrl, output };
  }
  normalizeResult({ requestId, request, body, output, mediaUrl }) {
    return Object.freeze({ provider: this.provider, model: request.providerSelection.model,
      capability: request.capability, requestId, output, mediaUrl, contentType: 'video/mp4', usage: this.protocol.usage?.(body) || body.metrics || null,
      provenance: Object.freeze({ provider: this.provider, vendor: request.providerSelection.vendor || null,
        model: request.providerSelection.model, modelVersion: request.providerSelection.modelVersion || null,
        profile: request.providerSelection.profile, capability: request.capability,
        resolvedSettings: request.resolvedSettings, canonicalPrompt: request.canonicalPrompt,
        providerTranslatedPrompt: request.providerPrompt, negativeIntent: request.negativeIntent,
        requestId, adapterFamily: this.protocol.adapterFamily }) });
  }
  async recover(externalRequestIdOrOptions, options = {}) {
    const requestId = typeof externalRequestIdOrOptions === 'object' ? externalRequestIdOrOptions.requestId : externalRequestIdOrOptions;
    const model = typeof externalRequestIdOrOptions === 'object' ? externalRequestIdOrOptions.model : options.model;
    const request = (typeof externalRequestIdOrOptions === 'object'
      ? externalRequestIdOrOptions.canonicalRequest || externalRequestIdOrOptions.request : null)
      || options.canonicalRequest || options.request || createCanonicalMediaRequest({ capability: 'TEXT_TO_VIDEO', prompt: 'recovered request',
      providerSelection: { provider: this.provider, model: model || this.modelFor(), profile: 'STANDARD' } });
    return this.pollAndDownload({ requestId, request });
  }
  async pollAndDownload({ requestId, request, initialBody = null }) {
    const startedAt = this.now(); let body = initialBody; let state = body ? this.protocol.state(body) : 'PENDING';
    while (!['SUCCEEDED','FAILED','CANCELED'].includes(state)) {
      if (this.now() - startedAt >= this.timeoutMs) throw new AsyncProviderError(this.provider, 'PROVIDER_TIMEOUT', `${this.provider} polling timed out`, { requestId });
      await this.sleep(this.pollIntervalMs);
      const polled = await this.status(requestId, request.providerSelection.model); state = polled.state; body = polled.body;
    }
    if (state !== 'SUCCEEDED') throw new AsyncProviderError(this.provider, 'PROVIDER_FAILED', `${this.provider} generation ${state.toLowerCase()}`, { requestId, body });
    const resultDescriptor = this.protocol.result(requestId, request.providerSelection.model, body);
    const resultBody = resultDescriptor.body || await this.requestJson(resultDescriptor.url, { method: 'GET', headers: this.headers() });
    const downloaded = await this.download(resultBody);
    return this.normalizeResult({ requestId, request, body: resultBody, ...downloaded });
  }
  async generate({ canonicalRequest, prompt, model, onProviderRequest } = {}) {
    const request = this.validate(canonicalRequest || parseLegacyPrompt(prompt, model || this.modelFor(), this.provider));
    const submitted = await this.submit(request);
    if (onProviderRequest) await onProviderRequest({ requestId: submitted.requestId, status: 'submitted' });
    return this.pollAndDownload({ requestId: submitted.requestId, request, initialBody: submitted.body });
  }
}

module.exports = { AsyncMediaProviderAdapter, AsyncProviderError };
