'use strict';

const { ProviderError } = require('./provider-contract');

function responseError(provider, response, payload = null) {
  const error = new ProviderError(`${provider} request failed`, { provider, cause: { status: response?.status, code: payload?.code || payload?.error?.code || 'PROVIDER_REQUEST_FAILED', requestId: response?.headers?.get?.('x-request-id') } });
  error.status = response?.status || error.status; return error;
}
async function jsonResponse(provider, response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw responseError(provider, response, body);
  return body || {};
}

class AvatarProviderAdapter {
  constructor({ provider, apiKey = null, fetchImpl = globalThis.fetch, baseUrl, mediaResolver = null } = {}) {
    if (!provider || !baseUrl || typeof fetchImpl !== 'function') throw new Error('provider, baseUrl and fetchImpl are required');
    this.provider = provider; this.apiKey = apiKey; this.fetch = fetchImpl; this.baseUrl = baseUrl.replace(/\/$/, ''); this.mediaResolver = mediaResolver;
  }
  headers({ idempotencyKey = null } = {}) {
    return { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) };
  }
  assertConfigured() {
    if (this.apiKey) return;
    const error = new ProviderError(`${this.provider} credentials are not configured`, { provider: this.provider });
    error.code = 'PROVIDER_CREDENTIAL_REQUIRED'; error.status = 409; throw error;
  }
  async materialize(result) {
    if (Buffer.isBuffer(result.output)) return result;
    if (!result.mediaUrl || !this.mediaResolver?.download) return result;
    const output = await this.mediaResolver.download({ provider: this.provider, url: result.mediaUrl });
    return { ...result, output: Buffer.from(output) };
  }
  async materializeAudio({ artifact, contract } = {}) {
    if (!artifact) return null;
    if (!this.mediaResolver?.materializeAudio) {
      const error = new ProviderError(`${this.provider} audio materialization is not configured`, { provider: this.provider, model: contract?.providerEngine });
      error.code = 'PROVIDER_MEDIA_MATERIALIZATION_UNAVAILABLE'; error.status = 503; throw error;
    }
    // The resolver may upload our immutable bytes, issue a short-lived signed URL,
    // or return a vendor asset ID. None of these values become canonical authority.
    return this.mediaResolver.materializeAudio({ provider: this.provider, artifact, contract });
  }
}

module.exports = { AvatarProviderAdapter, jsonResponse, responseError };
