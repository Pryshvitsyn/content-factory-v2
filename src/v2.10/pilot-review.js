'use strict';

const crypto = require('node:crypto');
const { sanitizePersistedValidation } = require('./locked-keyframe-state-service');
const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

function pilotReview({ draftId, brandId, workflow, attempt }) {
  if (!workflow || !attempt) return null;
  const artifact = attempt.result?.media?.artifact;
  const complete = attempt.boundary_state === 'COMPLETED' && ['SUCCEEDED','FAILED'].includes(attempt.status);
  const playable = complete && artifact?.artifactId && Number.isInteger(artifact.version)
    && artifact.version > 0 && /^[a-f0-9]{64}$/.test(artifact.contentHash || '') && artifact.storageKey;
  return Object.freeze({
    workflowId: workflow.id, attemptId: attempt.id, state: workflow.state, status: attempt.status,
    quality: sanitizePersistedValidation(attempt.result?.quality),
    contentUrl: playable ? `/api/v2.10/creative-drafts/${encodeURIComponent(draftId)}/pilot/${encodeURIComponent(attempt.id)}/content?brandId=${encodeURIComponent(brandId)}` : null,
    artifact: playable ? { id: artifact.artifactId, version: artifact.version, contentHash: artifact.contentHash } : null,
    canRestoreReview: complete && typeof attempt.result?.accepted === 'boolean'
      && ['KEYFRAME_APPROVED','FIRST_VIDEO_RUNNING'].includes(workflow.state),
    canApprove: Boolean(playable && workflow.state === 'FIRST_VIDEO_REVIEW'
      && attempt.status === 'SUCCEEDED' && attempt.result?.accepted === true),
    canReject: workflow.state === 'FIRST_VIDEO_REVIEW',
    blocksNewStart: Boolean(playable || ['RUNNING','NEEDS_RECONCILIATION'].includes(attempt.status)),
    externalCalls: 0,
  });
}

async function pilotContent({ repository, storage, scope, draftId, attemptId }) {
  const workflow = await repository.getLockedWorkflow({ draftId, ...scope });
  const attempt = workflow && await repository.getLatestLockedStageAttempt({ workflowId: workflow.id, ...scope, stage: 'FIRST_VIDEO' });
  const review = pilotReview({ draftId, brandId: scope.brandId, workflow, attempt });
  if (!review?.contentUrl || attempt.id !== attemptId) throw error('PILOT_CONTENT_NOT_FOUND', 'Saved pilot not found in this draft and brand', 404);
  if (!storage) throw error('PILOT_STORAGE_UNAVAILABLE', 'Pilot storage is unavailable', 503);
  const artifact = attempt.result.media.artifact;
  let bytes;
  try { bytes = await storage.get({ key: artifact.storageKey }); }
  catch (cause) {
    if (cause.code === 'ENOENT') throw error('PILOT_FILE_MISSING', 'Saved pilot file is missing. Restore it from storage; do not regenerate automatically.', 404);
    throw cause;
  }
  if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== artifact.contentHash) {
    throw error('PILOT_CONTENT_HASH_MISMATCH', 'Pilot bytes do not match the saved immutable artifact');
  }
  if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp') throw error('PILOT_CONTENT_TYPE_INVALID', 'Saved pilot is not an MP4');
  return { bytes, contentType: 'video/mp4' };
}

module.exports = { pilotReview, pilotContent };
