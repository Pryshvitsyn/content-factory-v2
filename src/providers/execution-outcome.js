'use strict';
const LEGACY_RESOLUTION_REJECTION = 'Replicate request failed with HTTP 422: - input.resolution: resolution must be one of the following: "480p", "720p"';
function rejectedBeforeCreation(error, requestId = null) {
  if (requestId || error?.details?.providerExecutionOutcome !== 'REJECTED_BEFORE_CREATION') return false;
  return (error.details.operation === 'CREATE_PREDICTION' && [400,422].includes(error.details.httpStatus))
    || (error.details.operation === 'LOCAL_INPUT_VALIDATION' && error.provider === 'replicate'
      && ['REPLICATE_INPUT_INVALID','UNSUPPORTED_RESOLUTION'].includes(error.code));
}
function legacyResolutionRejection(row) {
  return !row?.provider_request_id && !row?.provider_status && !row?.artifact_id && !row?.artifact_version
    && !row?.artifact_storage_key && JSON.stringify(row?.result || {}) === '{}'
    && row?.status === 'NEEDS_RECONCILIATION'
    && (!row.stage || (row.stage === 'FIRST_VIDEO' && row.boundary_state === 'MAY_HAVE_STARTED'))
    && (!row.provider || (row.provider === 'replicate' && row.model === 'bytedance/seedance-2.5'))
    && row.error?.code === 'REPLICATE_HTTP_ERROR'
    && String(row.error?.message || '').trim() === LEGACY_RESOLUTION_REJECTION;
}
module.exports = { rejectedBeforeCreation, legacyResolutionRejection, LEGACY_RESOLUTION_REJECTION };
