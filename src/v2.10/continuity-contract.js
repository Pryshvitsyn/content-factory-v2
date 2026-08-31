'use strict';

const { CAPABILITIES } = require('../v2.8/capabilities');
const { canonicalCreativeBrief } = require('./creative-contract');

function validateContinuity(input, provider = {}) {
  const brief = canonicalCreativeBrief(input);
  const capabilities = new Set(provider.capabilities || []);
  const checks = [];
  for (let index = 0; index < brief.storyboard.length; index += 1) {
    const shot = brief.storyboard[index];
    const policy = shot.referencePolicy;
    if (policy === 'PREVIOUS_SHOT_FRAME') {
      if (index === 0) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'The first shot has no previous succeeded frame.' });
      else if (!capabilities.has(CAPABILITIES.IMAGE_TO_VIDEO) && !capabilities.has(CAPABILITIES.REFERENCE_TO_VIDEO)) {
        checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'Selected provider/model lacks required image/reference-to-video capability.' });
      } else checks.push({ shotId: shot.shotId, status: 'READY', policy });
    } else if (policy === 'UPLOADED_REFERENCE') {
      if (!shot.referenceMedia?.artifactId) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'An immutable uploaded reference artifact is required.' });
      else if (!capabilities.has(CAPABILITIES.IMAGE_TO_VIDEO) && !capabilities.has(CAPABILITIES.REFERENCE_TO_VIDEO)) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'Selected provider/model lacks required image/reference-to-video capability.' });
      else checks.push({ shotId: shot.shotId, status: 'READY', policy, artifactId: shot.referenceMedia.artifactId });
    } else checks.push({ shotId: shot.shotId, status: 'READY', policy: 'NONE' });
  }
  return Object.freeze({ status: checks.some((check) => check.status === 'BLOCKED') ? 'BLOCKED' : 'READY', checks: Object.freeze(checks) });
}

function resolveReferenceEvidence({ brief: input, shotIndex, artifacts = [] } = {}) {
  const brief = canonicalCreativeBrief(input); const shot = brief.storyboard[shotIndex];
  if (!shot) throw Object.assign(new Error('Shot does not exist'), { code: 'SHOT_NOT_FOUND' });
  if (shot.referencePolicy === 'NONE') return null;
  if (shot.referencePolicy === 'PREVIOUS_SHOT_FRAME') {
    if (shotIndex === 0) throw Object.assign(new Error('The first shot has no previous frame'), { code: 'REFERENCE_EVIDENCE_MISSING' });
    const prior = brief.storyboard[shotIndex - 1];
    const artifact = artifacts.find((item) => item.shotId === prior.shotId && item.kind === 'FRAME'
      && item.status === 'SUCCEEDED' && item.immutable === true && item.contentHash && item.storageKey);
    if (!artifact) throw Object.assign(new Error('Persisted immutable frame from the previous succeeded shot is required'), { code: 'REFERENCE_EVIDENCE_MISSING' });
    return Object.freeze({ policy: shot.referencePolicy, artifactId: artifact.artifactId, version: artifact.version,
      storageKey: artifact.storageKey, contentHash: artifact.contentHash, previousShotId: prior.shotId });
  }
  const artifact = artifacts.find((item) => item.artifactId === shot.referenceMedia?.artifactId
    && item.source === 'OPERATOR_UPLOAD' && item.immutable === true && item.contentHash && item.storageKey);
  if (!artifact) throw Object.assign(new Error('Immutable operator-uploaded reference evidence is required'), { code: 'REFERENCE_EVIDENCE_MISSING' });
  return Object.freeze({ policy: shot.referencePolicy, artifactId: artifact.artifactId, version: artifact.version,
    storageKey: artifact.storageKey, contentHash: artifact.contentHash });
}

function validateAvatarContinuityReadiness(input = {}) {
  const required = Object.freeze([
    ['identity','AVATAR_IDENTITY_CONTINUITY'], ['wardrobe','AVATAR_WARDROBE_CONTINUITY'],
    ['props','AVATAR_PROP_CONTINUITY'], ['location','AVATAR_LOCATION_CONTINUITY'],
    ['geometry','AVATAR_GEOMETRY_CONTINUITY'], ['voice','AVATAR_VOICE_CONTINUITY'], ['lipSync','AVATAR_LIP_SYNC'],
  ]);
  const checks = required.map(([field, code]) => Object.freeze({ code,
    status: String(input[field]?.status || input[field] || '').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL' }));
  const shotContinuity = input.brief && input.provider ? validateContinuity(input.brief, input.provider) : null;
  if (shotContinuity?.status === 'BLOCKED') checks.push(Object.freeze({ code: 'EXISTING_SHOT_CONTINUITY', status: 'FAIL',
    reason: 'Existing V2.10 shot continuity contract is blocked.' }));
  return Object.freeze({ status: checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    checks: Object.freeze(checks), shotContinuity, engine: 'V2.10_CONTINUITY_CONTRACT' });
}

module.exports = { resolveReferenceEvidence, validateAvatarContinuityReadiness, validateContinuity };
