'use strict';

const crypto = require('node:crypto');
const RENDERER_TYPES = Object.freeze(['THREE_JS', 'REMOTION', 'HTML_CANVAS', 'WEBGL_SHADER', 'FFMPEG', 'CUSTOM_LOCAL_RENDERER']);
const CAPABILITIES = Object.freeze(['STATE_RENDER', 'STATE_TRANSITION']);
function text(value) { return String(value ?? '').trim(); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {}); return value; }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function canonicalRenderSource(raw = {}) {
  const rendererType = text(raw.rendererType).toUpperCase();
  return Object.freeze({ schemaVersion: 'content-factory-render-source/1', rendererType: RENDERER_TYPES.includes(rendererType) ? rendererType : null,
    rendererId: text(raw.rendererId), displayName: text(raw.displayName), capabilities: [...new Set((Array.isArray(raw.capabilities) ? raw.capabilities : []).map((v) => text(v).toUpperCase()).filter((v) => CAPABILITIES.includes(v)))],
    supportedStates: [...new Set((Array.isArray(raw.supportedStates) ? raw.supportedStates : []).map((v) => text(v).toUpperCase()).filter(Boolean))],
    defaultOutput: { width: Number(raw.defaultOutput?.width), height: Number(raw.defaultOutput?.height), fps: Number(raw.defaultOutput?.fps) },
    // Deliberately retain no executable fields: manifests are untrusted declarative data only.
    fingerprint: fingerprint({ rendererId: text(raw.rendererId), rendererType, capabilities: raw.capabilities, supportedStates: raw.supportedStates, defaultOutput: raw.defaultOutput }) });
}
function validateRenderRequest(manifestInput, request = {}) {
  const manifest = canonicalRenderSource(manifestInput); const fromState = text(request.fromState).toUpperCase(); const toState = text(request.toState).toUpperCase();
  if (!manifest.rendererId || !manifest.rendererType) return { status: 'FAIL', code: 'RENDERER_MANIFEST_INVALID', manifest };
  if (fromState && !manifest.supportedStates.includes(fromState)) return { status: 'FAIL', code: 'RENDERER_STATE_UNSUPPORTED', manifest };
  if (toState && !manifest.supportedStates.includes(toState)) return { status: 'FAIL', code: 'RENDERER_STATE_UNSUPPORTED', manifest };
  if (fromState && toState && !manifest.capabilities.includes('STATE_TRANSITION')) return { status: 'FAIL', code: 'RENDERER_TRANSITION_UNSUPPORTED', manifest };
  return { status: 'PASS', manifest };
}
module.exports = { RENDERER_TYPES, CAPABILITIES, canonicalRenderSource, validateRenderRequest };
