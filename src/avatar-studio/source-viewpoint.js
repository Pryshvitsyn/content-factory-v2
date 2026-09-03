'use strict';

const IDENTITY_VIEWPOINTS = Object.freeze(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT','PROFILE_LEFT','PROFILE_RIGHT','OTHER','UNKNOWN']);

function viewpoint(value) {
  const normalized = String(value || 'UNKNOWN').trim().toUpperCase();
  if (!IDENTITY_VIEWPOINTS.includes(normalized)) { const error = new Error('Choose a supported human identity viewpoint'); error.code = 'IDENTITY_VIEWPOINT_INVALID'; throw error; }
  return normalized;
}
function effectiveViewpoint(source = {}) { return viewpoint(source.viewpointClassifications?.[0]?.viewpoint || source.provenance?.identityViewpoint || source.provenance?.viewpoint || 'UNKNOWN'); }
function viewpointSnapshot(sources = []) { return Object.freeze(sources.map((source) => Object.freeze({ sourceAssetId: source.id, viewpoint: effectiveViewpoint(source), classificationId: source.viewpointClassifications?.[0]?.id || null }))); }
function viewpointSnapshotMatches(snapshot, sources) {
  if (!snapshot?.length) return sources.every((source) => !(source.viewpointClassifications || []).length);
  return JSON.stringify(snapshot) === JSON.stringify(viewpointSnapshot(sources));
}

module.exports = { IDENTITY_VIEWPOINTS, effectiveViewpoint, viewpoint, viewpointSnapshot, viewpointSnapshotMatches };
