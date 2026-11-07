'use strict';

const { createHash } = require('node:crypto');
const { fingerprint, freeze } = require('../v2.10/creative-contract');
const VERSION = 'replicate-files/1';
// Conservative local transport policy, following the HTTP API's URL guidance.
// This is not a claimed model image-size limit.
const INLINE_LIMIT = 256 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function decode(uri) {
  const match = /^data:(image\/(?:png|jpeg|webp|bmp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  const bytes = match && Buffer.from(match[2], 'base64');
  if (!bytes?.length || bytes.toString('base64') !== match[2]) throw failure('REFERENCE_ENCODING_INVALID', 'Reference must contain canonical base64 image bytes');
  if (bytes.length > 10 * 1024 * 1024) throw failure('REFERENCE_SIZE_EXCEEDED', 'Image exceeds the local 10 MiB reference budget');
  return { bytes, contentType: match[1] };
}
function at(input, path) { return path.reduce((value, key) => value[key], input); }
function planReplicateFiles(input) {
  const paths = ['image', 'last_frame_image'].filter(key => input[key]).map(key => [key]);
  (input.reference_images || []).forEach((_, index) => paths.push(['reference_images', index]));
  const files = [];
  try {
    for (const path of paths) {
      const uri = at(input, path);
      if (!String(uri).startsWith('data:')) continue;
      const { bytes, contentType } = decode(uri);
      if (bytes.length > INLINE_LIMIT) files.push({ path, sha256: sha256(bytes), bytes: bytes.length, contentType });
    }
  } catch (error) {
    error.boundaryState = 'NOT_CROSSED';
    error.details = { operation: 'LOCAL_INPUT_VALIDATION', providerExecutionOutcome: 'REJECTED_BEFORE_CREATION' };
    throw error;
  }
  return freeze({ version: VERSION, inlineLimitBytes: INLINE_LIMIT, files, uploadCalls: files.length,
    uploadWhen: 'EXPLICIT_START', networkCallsMade: 0 });
}
function verifyReceipt(file, expected, now, minimumLifetimeMs) {
  if (!file || typeof file.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(file.id)
    || file.checksums?.sha256 !== expected.sha256 || file.size !== expected.bytes || file.content_type !== expected.contentType) {
    throw failure('REFERENCE_UPLOAD_IDENTITY_MISMATCH', 'Uploaded file receipt does not match the original image SHA-256, size and MIME type');
  }
  let url;
  try { url = new URL(file.urls?.get); } catch { throw failure('REFERENCE_UPLOAD_URL_INVALID', 'Uploaded file has no valid download URL'); }
  const validHost = url.hostname === 'api.replicate.com'
    ? (url.pathname === `/v1/files/${file.id}` || url.pathname === `/v1/files/${file.id}/download`)
    : url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !validHost) {
    throw failure('REFERENCE_UPLOAD_URL_INVALID', 'Uploaded file URL is outside the verified Replicate transport');
  }
  const deadlines = [];
  if (file.expires_at !== null) {
    const expiry = Date.parse(file.expires_at);
    if (!Number.isFinite(expiry)) throw failure('REFERENCE_UPLOAD_EXPIRY_INVALID', 'Upload response omitted a valid expiry declaration');
    deadlines.push(expiry);
  }
  if (url.searchParams.has('expiry')) deadlines.push(Number(url.searchParams.get('expiry')) * 1000);
  if (deadlines.some(deadline => !Number.isFinite(deadline) || deadline <= now + minimumLifetimeMs)) {
    throw failure('REFERENCE_UPLOAD_EXPIRED', 'Uploaded reference URL expires before the generation timeout');
  }
  return { ...expected, fileId: file.id, expiresAt: file.expires_at,
    urlSha256: sha256(url.href), validUntil: deadlines.length ? Math.min(...deadlines) : null };
}

// Pure planning above is used by preflight. This function runs only inside Start's
// durable claim and adapter in-flight fence. Uploads never create predictions.
async function prepareReplicateFiles({ input, plan, canonicalFingerprint, endpoint, apiToken, fetchImpl,
  now = Date.now, timeoutMs = 60000, minimumLifetimeMs = 600000, onEvidence }) {
  const evidence = { version: VERSION, canonicalFingerprint, uploadCalls: 0, files: [] };
  const wire = structuredClone(input);
  try {
    if (fingerprint(planReplicateFiles(input)) !== fingerprint(plan)) throw failure('REFERENCE_TRANSPORT_STALE', 'Reference transport plan changed after preflight');
    if (plan.files.length && (!apiToken || typeof onEvidence !== 'function')) {
      throw failure('REFERENCE_TRANSPORT_JOURNAL_REQUIRED', 'File transport requires credentials and a durable evidence callback before upload');
    }
    if (plan.files.length && endpoint !== `https://api.replicate.com/v1/models/alibaba/wan-3/predictions`) {
      throw failure('REFERENCE_TRANSPORT_ENDPOINT_UNVERIFIED', 'File upload is enabled only for the verified Replicate Wan 3 endpoint');
    }
    for (const expected of plan.files) {
      const { bytes, contentType } = decode(at(input, expected.path));
      // Recheck at the last local boundary. Never transform/re-encode the image.
      if (sha256(bytes) !== expected.sha256) throw failure('REFERENCE_UPLOAD_IDENTITY_MISMATCH', 'Reference bytes changed before upload');
      const form = new FormData();
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' }[contentType];
      form.append('content', new Blob([bytes], { type: contentType }), `${expected.sha256}.${ext}`);
      await onEvidence(freeze({ ...structuredClone(evidence), phase: 'UPLOAD_REQUESTED', pendingUpload: expected }));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let file;
      try {
        evidence.uploadCalls++;
        const response = await fetchImpl('https://api.replicate.com/v1/files', { method: 'POST', body: form,
          headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
        if (!response.ok) throw failure('REFERENCE_UPLOAD_HTTP_ERROR', `Replicate file upload failed with HTTP ${response.status}; no prediction was submitted`);
        file = await response.json();
      } finally { clearTimeout(timer); }
      const receipt = verifyReceipt(file, expected, now(), minimumLifetimeMs);
      evidence.files.push(receipt);
      await onEvidence(freeze({ ...structuredClone(evidence), phase: 'UPLOAD_VERIFIED' }));
      const parent = expected.path.slice(0, -1).reduce((value, key) => value[key], wire);
      parent[expected.path.at(-1)] = file.urls.get;
    }
    for (const file of evidence.files) {
      if (file.validUntil !== null && file.validUntil <= now() + minimumLifetimeMs) throw failure('REFERENCE_UPLOAD_EXPIRED', 'Reference URL expired while preparing the request');
    }
    // This hash certifies the actual JSON body, including the returned file URL.
    // Persist only its digest; signed URLs are ephemeral credentials.
    evidence.wirePayloadSha256 = sha256(JSON.stringify({ input: wire }));
    evidence.wireFingerprint = fingerprint({ endpoint, canonicalFingerprint,
      wirePayloadSha256: evidence.wirePayloadSha256, files: evidence.files });
    evidence.phase = 'PREDICTION_PREPARED';
    if (plan.files.length) await onEvidence(freeze(structuredClone(evidence)));
    return { input: freeze(wire), evidence: freeze(evidence) };
  } catch (cause) {
    // This catch ends BEFORE the prediction POST. A failed upload can leave a
    // temporary file, but cannot have started paid video generation.
    const error = failure(cause.code || 'REFERENCE_UPLOAD_FAILED', cause.code ? cause.message : 'Reference file preparation failed; no prediction was submitted');
    error.boundaryState = 'NOT_CROSSED';
    error.details = { operation: 'REFERENCE_FILE_UPLOAD', providerExecutionOutcome: 'REJECTED_BEFORE_CREATION',
      predictionPostStarted: false, fileUploadOutcome: evidence.uploadCalls ? 'CHECK_EVIDENCE' : 'NOT_STARTED',
      transport: evidence };
    throw error;
  }
}
function redactTransportError(error, input, plan) {
  const urls = plan.files.map(file => at(input, file.path));
  const clean = value => {
    if (typeof value === 'string') return urls.reduce((text, url) => text.split(url).join('[uploaded reference URL]'), value);
    if (value instanceof Error) return { name: value.name, message: clean(value.message) };
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  error.message = clean(error.message); error.stack = clean(error.stack);
  if (error.cause) error.cause = clean(error.cause);
  if (error.details) error.details = clean(error.details);
  return error;
}
module.exports = { VERSION, INLINE_LIMIT, planReplicateFiles, prepareReplicateFiles, verifyReceipt, redactTransportError };
