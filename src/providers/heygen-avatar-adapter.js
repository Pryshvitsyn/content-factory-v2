'use strict';

const { AvatarProviderAdapter, jsonResponse } = require('./avatar-provider-adapter');
const { ProviderError } = require('./provider-contract');

class HeyGenAvatarAdapter extends AvatarProviderAdapter {
  constructor(options = {}) { super({ provider: 'HEYGEN', baseUrl: 'https://api.heygen.com', ...options }); }
  headers({ idempotencyKey = null } = {}) { return { 'content-type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }; }
  async provision({ binding, trainingMedia = null, idempotencyKey, onProviderRequest } = {}) {
    this.assertConfigured(); if (binding.providerBindingType === 'HEYGEN_DIGITAL_TWIN_API' && binding.entitlementVerified !== true) { const error=new ProviderError('HEYGEN Digital Twin entitlement is required',{provider:'HEYGEN'});error.code='PROVIDER_ENTITLEMENT_REQUIRED';throw error; }
    const body=await jsonResponse('HEYGEN',await this.fetch(`${this.baseUrl}/v3/avatars`,{method:'POST',headers:this.headers({idempotencyKey}),body:JSON.stringify({binding_type:binding.providerBindingType,training_media:trainingMedia||null})})); const requestId=body.data?.id||body.data?.avatar_id||body.id;
    await onProviderRequest?.({requestId,status:'PROVISIONING_SUBMITTED'}); return {provider:'HEYGEN',requestId,externalId:body.data?.avatar_id||requestId,raw:body};
  }
  async generate({ contract, binding, idempotencyKey, onProviderRequest } = {}) {
    this.assertConfigured();
    if (!binding?.providerExternalId) throw new ProviderError('HEYGEN binding is required', { provider: 'HEYGEN', model: contract?.providerEngine });
    // V3 only.  This adapter intentionally contains no /v1 or /v2 generation route.
    const response = await this.fetch(`${this.baseUrl}/v3/videos`, { method: 'POST', headers: this.headers({ idempotencyKey }), body: JSON.stringify({
      avatar_id: binding.providerExternalId, avatar_version: contract.providerEngine, caption: false, dimension: { width: 1080, height: 1920 },
      video_inputs: [{ character: { type: 'avatar', avatar_id: binding.providerExternalId, avatar_style: contract.providerEngine },
        voice: contract.audioStrategy === 'EXTERNAL_AUDIO' ? { type: 'audio', audio_url: contract.audioArtifact?.providerUrl || contract.audioArtifact?.url } : { type: 'text', input_text: contract.script, language: contract.language },
        background: { type: 'color', value: contract.backgroundPolicy } }],
    }) });
    const body = await jsonResponse('HEYGEN', response); const requestId = body.data?.video_id || body.data?.id || body.video_id || body.id;
    if (!requestId) throw new ProviderError('HEYGEN V3 did not return video id', { provider: 'HEYGEN', model: contract.providerEngine });
    await onProviderRequest?.({ requestId, status: 'SUBMITTED' });
    return { provider: 'HEYGEN', model: contract.providerEngine, requestId, mediaUrl: body.data?.video_url || body.data?.url || null, output: null, raw: body };
  }
  async recover({ requestId, contract } = {}) {
    this.assertConfigured();
    const response = await this.fetch(`${this.baseUrl}/v3/videos/${encodeURIComponent(requestId)}`, { headers: this.headers() }); const body = await jsonResponse('HEYGEN', response);
    return this.materialize({ provider: 'HEYGEN', model: contract.providerEngine, requestId, mediaUrl: body.data?.video_url || body.data?.url || null, output: null, raw: body });
  }
}
module.exports = { HeyGenAvatarAdapter };
