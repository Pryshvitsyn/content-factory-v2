'use strict';

const { AvatarProviderAdapter, jsonResponse } = require('./avatar-provider-adapter');
const { ProviderError } = require('./provider-contract');

class TavusAvatarAdapter extends AvatarProviderAdapter {
  constructor(options = {}) { super({ provider: 'TAVUS', baseUrl: 'https://tavusapi.com', ...options }); }
  headers({ idempotencyKey = null } = {}) { return { 'content-type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }; }
  async provision({ trainingMedia, consentEvidence, idempotencyKey, onProviderRequest } = {}) { this.assertConfigured(); const body=await jsonResponse('TAVUS',await this.fetch(`${this.baseUrl}/v2/replicas`,{method:'POST',headers:this.headers({idempotencyKey}),body:JSON.stringify({training_video_url:trainingMedia?.url,consent_evidence:consentEvidence||null})})); const requestId=body.replica_id||body.id; await onProviderRequest?.({requestId,status:'PROVISIONING_SUBMITTED'});return {provider:'TAVUS',requestId,externalId:requestId,raw:body}; }
  async generate({ contract, binding, idempotencyKey, onProviderRequest } = {}) {
    this.assertConfigured();
    if (!binding?.providerExternalId) throw new ProviderError('TAVUS replica binding is required', { provider: 'TAVUS', model: contract?.providerEngine });
    const body = await jsonResponse('TAVUS', await this.fetch(`${this.baseUrl}/v2/videos`, { method: 'POST', headers: this.headers({ idempotencyKey }), body: JSON.stringify({
      replica_id: binding.providerExternalId, video_name: `avatar-performance-${contract.requestFingerprint.slice(0, 16)}`,
      ...(contract.audioStrategy === 'EXTERNAL_AUDIO' ? { audio_url: contract.audioArtifact?.providerUrl || contract.audioArtifact?.url } : { script: contract.script }),
    }) }));
    const requestId = body.video_id || body.id; if (!requestId) throw new ProviderError('TAVUS did not return video id', { provider: 'TAVUS', model: contract.providerEngine });
    await onProviderRequest?.({ requestId, status: 'SUBMITTED' }); return { provider: 'TAVUS', model: contract.providerEngine, requestId, mediaUrl: body.download_url || body.video_url || null, output: null, raw: body };
  }
  async recover({ requestId, contract } = {}) { this.assertConfigured(); const body = await jsonResponse('TAVUS', await this.fetch(`${this.baseUrl}/v2/videos/${encodeURIComponent(requestId)}`, { headers: this.headers() })); return this.materialize({ provider: 'TAVUS', model: contract.providerEngine, requestId, mediaUrl: body.download_url || body.video_url || null, output: null, raw: body }); }
}
module.exports = { TavusAvatarAdapter };
