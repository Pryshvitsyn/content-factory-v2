'use strict';

const { AvatarProviderAdapter, jsonResponse } = require('./avatar-provider-adapter');
const { ProviderError } = require('./provider-contract');

class DidAvatarAdapter extends AvatarProviderAdapter {
  constructor(options = {}) { super({ provider: 'DID', baseUrl: 'https://api.d-id.com', ...options }); }
  headers({ idempotencyKey = null } = {}) { return { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Basic ${this.apiKey}` } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }; }
  async provision({ trainingMedia, consentEvidence, idempotencyKey, onProviderRequest } = {}) { this.assertConfigured(); const body=await jsonResponse('DID',await this.fetch(`${this.baseUrl}/scenes/avatars`,{method:'POST',headers:this.headers({idempotencyKey}),body:JSON.stringify({source_url:trainingMedia?.url,consent_id:consentEvidence?.providerConsentId,persist:true})})); const requestId=body.id||body.avatar_id; await onProviderRequest?.({requestId,status:'PROVISIONING_SUBMITTED'});return {provider:'DID',requestId,externalId:requestId,raw:body}; }
  async generate({ contract, binding, idempotencyKey, onProviderRequest } = {}) {
    this.assertConfigured();
    if (!binding?.providerExternalId) throw new ProviderError('D-ID avatar binding is required', { provider: 'DID', model: contract?.providerEngine });
    const body = await jsonResponse('DID', await this.fetch(`${this.baseUrl}/scenes`, { method: 'POST', headers: this.headers({ idempotencyKey }), body: JSON.stringify({
      avatar_id: binding.providerExternalId, output_format: contract.outputFormat,
      script: contract.audioStrategy === 'EXTERNAL_AUDIO' ? { type: 'audio', audio_url: contract.audioArtifact?.providerUrl || contract.audioArtifact?.url } : { type: 'text', input: contract.script, language: contract.language },
    }) }));
    const requestId = body.scene_id || body.id; if (!requestId) throw new ProviderError('D-ID did not return scene id', { provider: 'DID', model: contract.providerEngine });
    await onProviderRequest?.({ requestId, status: 'SUBMITTED' }); return { provider: 'DID', model: contract.providerEngine, requestId, mediaUrl: body.result_url || body.video_url || null, output: null, raw: body };
  }
  async recover({ requestId, contract } = {}) { this.assertConfigured(); const body = await jsonResponse('DID', await this.fetch(`${this.baseUrl}/scenes/${encodeURIComponent(requestId)}`, { headers: this.headers() })); return this.materialize({ provider: 'DID', model: contract.providerEngine, requestId, mediaUrl: body.result_url || body.video_url || null, output: null, raw: body }); }
}
module.exports = { DidAvatarAdapter };
