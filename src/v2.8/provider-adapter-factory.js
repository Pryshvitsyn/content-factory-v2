'use strict';

const { AsyncMediaProviderAdapter } = require('./async-media-provider-adapter');
const { PROTOCOLS, createAlibabaProtocol } = require('./provider-protocols');
const { ReplicateWanVideoAdapter } = require('../providers/replicate-wan-video-adapter');
const { ReplicateUniversalVideoAdapter } = require('../providers/replicate-universal-video-adapter');

function credential(provider, env) {
  if (provider === 'fal') return env.FAL_KEY;
  if (provider === 'runway') return env.RUNWAYML_API_SECRET;
  if (provider === 'google') return env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
  if (provider === 'luma') return env.LUMA_API_KEY;
  if (provider === 'alibaba') return env.DASHSCOPE_API_KEY;
  return null;
}

function createVideoAdapter(selection, { env = process.env, fetchImpl = global.fetch, sleep, now,
  pollIntervalMs, timeoutMs } = {}) {
  if (selection.provider === 'replicate' && selection.adapterFamily === 'replicate-wan') {
    return new ReplicateWanVideoAdapter({ apiToken: env.REPLICATE_API_TOKEN, model: selection.model,
      fetchImpl, ...(sleep ? { sleep } : {}), ...(now ? { now } : {}),
      ...(pollIntervalMs ? { pollIntervalMs } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  }
  if (selection.provider === 'replicate' && ['replicate-wan-3','replicate-seedance-2.5'].includes(selection.adapterFamily)) {
    return new ReplicateUniversalVideoAdapter({ apiToken: env.REPLICATE_API_TOKEN, model: selection.model,
      family: selection.adapterFamily === 'replicate-wan-3' ? 'WAN_3' : 'SEEDANCE_2_5', fetchImpl,
      ...(sleep ? { sleep } : {}), ...(now ? { now } : {}), ...(pollIntervalMs ? { pollIntervalMs } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  }
  const baseProtocol = selection.provider === 'alibaba'
    ? createAlibabaProtocol({ region: env.ALIBABA_MODEL_STUDIO_REGION, workspaceId: env.ALIBABA_MODEL_STUDIO_WORKSPACE_ID })
    : PROTOCOLS[selection.provider];
  const protocol = baseProtocol && selection.provider === 'fal' && !baseProtocol.models.includes(selection.model)
    ? Object.freeze({ ...baseProtocol, models: Object.freeze([...baseProtocol.models, selection.model]) }) : baseProtocol;
  if (!protocol || selection.adapterFamily !== protocol.adapterFamily) {
    const error = new Error(`No verified adapter for ${selection.provider}/${selection.model}`);
    error.code = 'SELECTED_MODEL_UNAVAILABLE'; throw error;
  }
  return new AsyncMediaProviderAdapter({ protocol, credential: credential(selection.provider, env), fetchImpl,
    ...(sleep ? { sleep } : {}), ...(now ? { now } : {}), ...(pollIntervalMs ? { pollIntervalMs } : {}),
    ...(timeoutMs ? { timeoutMs } : {}) });
}

module.exports = { createVideoAdapter };
