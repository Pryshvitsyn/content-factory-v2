'use strict';
const { fingerprint } = require('./creative-contract');

function lookFingerprint(state, keyframe) {
  if (!keyframe?.id || !keyframe.version || !keyframe.content_hash || !keyframe.storage_key
    || keyframe.validation_status !== 'PASS') return null;
  const identity = { artifactId: keyframe.id, version: Number(keyframe.version),
    contentHash: keyframe.content_hash, storageKey: keyframe.storage_key,
    validationEventId: keyframe.validation_event_id };
  if (!state.script?.approved || !state.storyboard?.approved) return null;
  return fingerprint({ schema: 'quality-look/2', keyframe: identity,
    script: { fingerprint: state.script.fingerprint, eventId: state.script.eventId },
    storyboard: { fingerprint: state.storyboard.fingerprint, eventId: state.storyboard.eventId } });
}
function describeLook(state, keyframe, reference, event) {
  let expectedFingerprint = null;
  try { if (keyframe) expectedFingerprint = lookFingerprint(state, keyframe); } catch { /* Fail closed. */ }
  const bound = keyframe && reference?.artifactId === keyframe.id
    && Number(reference.version) === Number(keyframe.version)
    && reference.contentHash === keyframe.content_hash && reference.storageKey === keyframe.storage_key;
  const approved = Boolean(expectedFingerprint && bound && keyframe.approval_decision === 'APPROVED' && event?.decision === 'APPROVED'
    && event.subject_id === keyframe.id && event.subject_fingerprint === expectedFingerprint);
  const status = approved ? 'APPROVED' : !state.script?.approved || !state.storyboard?.approved ? 'BLOCKED_UPSTREAM'
    : expectedFingerprint ? 'REVIEW_REQUIRED' : 'KEYFRAME_REQUIRED';
  const reason = approved ? null : status === 'BLOCKED_UPSTREAM' ? 'Approve the current Script and Storyboard first.'
    : status === 'REVIEW_REQUIRED' ? 'Review this existing frame against the current Script and Storyboard, then explicitly approve LOOK.'
    : 'A current PASS keyframe with exact immutable identity is required.';
  return Object.freeze({ ...state.look, approved, fingerprint: approved ? expectedFingerprint : null,
    status, reason, expectedFingerprint, keyframeId: keyframe?.id || null,
    keyframeApprovalDecision: keyframe?.approval_decision || null,
    canApprove: Boolean(expectedFingerprint), externalCalls: 0 });
}
module.exports = { lookFingerprint, describeLook };
