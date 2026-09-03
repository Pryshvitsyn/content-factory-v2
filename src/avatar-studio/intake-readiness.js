'use strict';

const MEDIA_INVALID_CODES = new Set(['INVALID_MIME_TYPE','MIME_EXTENSION_MISMATCH','UNRECOGNIZED_MEDIA_SIGNATURE',
  'MIME_SIGNATURE_MISMATCH','MEDIA_EMPTY','MEDIA_UNREADABLE','MEDIA_VIDEO_STREAM_MISSING','MEDIA_DIMENSIONS_INVALID']);
const SECURITY_CODES = new Set(['PROMPT_INJECTION','CONCEALED_ACTION','EMBEDDED_EXECUTION','SECRET_REQUEST','EXTERNAL_UPLOAD']);
const PROVENANCE_CODES = new Set(['PROVENANCE_UNCERTAIN','FACE_CONSENT_REQUIRED','VOICE_CONSENT_REQUIRED']);
const MIN_IDENTITY_SOURCE_EDGE = 512;

const SOURCE_READINESS_STATES = Object.freeze([
  'SOURCE READY','REVIEW REQUIRED','UNSUPPORTED FORMAT','INVALID MEDIA','SECURITY BLOCKED',
  'QUALITY INSUFFICIENT','PROVENANCE/CONSENT REQUIRED',
]);
const VALIDATION_CLASSES = Object.freeze([
  'MEDIA_INVALID','FORMAT_UNSUPPORTED','SECURITY_BLOCK','SECURITY_FALSE_POSITIVE','PROVENANCE_REQUIRED',
  'QUALITY_INSUFFICIENT','REVIEW_REQUIRED',
]);

function sourceReadiness({ media = {}, gate0 = {} } = {}) {
  const findings = gate0.findings || media.findings || [];
  const codes = new Set(findings.map((item) => item.code));
  if (codes.has('FORMAT_UNSUPPORTED')) return Object.freeze({ state: 'UNSUPPORTED FORMAT', validationClass: 'FORMAT_UNSUPPORTED',
    ready: false, reason: 'This is valid image-family media, but Avatar Studio does not support this encoding.' });
  if ([...codes].some((code) => MEDIA_INVALID_CODES.has(code))) return Object.freeze({ state: 'INVALID MEDIA', validationClass: 'MEDIA_INVALID',
    ready: false, reason: 'The declared file, signature, extension, or decoder result did not form a valid supported media asset.' });
  if (codes.has('SECURITY_FALSE_POSITIVE')) return Object.freeze({ state: 'REVIEW REQUIRED', validationClass: 'SECURITY_FALSE_POSITIVE',
    ready: false, reason: 'A security match was traced to non-structured binary data and must be treated as an implementation defect.' });
  if ([...codes].some((code) => SECURITY_CODES.has(code))) return Object.freeze({ state: 'SECURITY BLOCKED', validationClass: 'SECURITY_BLOCK',
    ready: false, reason: 'Bounded structured metadata contains a genuine security-policy match. The original file remains immutable.' });
  if ([...codes].some((code) => PROVENANCE_CODES.has(code))) return Object.freeze({ state: 'PROVENANCE/CONSENT REQUIRED', validationClass: 'PROVENANCE_REQUIRED',
    ready: false, reason: 'The media is technically valid, but ownership, provenance, or explicit face/voice consent is still required.' });
  if (media.kind === 'image' && (!media.width || !media.height
    || Math.min(Number(media.width),Number(media.height)) < MIN_IDENTITY_SOURCE_EDGE)) {
    return Object.freeze({ state: 'QUALITY INSUFFICIENT', validationClass: 'QUALITY_INSUFFICIENT', ready: false,
      reason: `A source photograph needs decodable dimensions with each edge at least ${MIN_IDENTITY_SOURCE_EDGE} pixels.` });
  }
  if (gate0.status === 'REVIEW' || findings.some((item) => item.severity === 'REVIEW')) return Object.freeze({ state: 'REVIEW REQUIRED',
    validationClass: 'REVIEW_REQUIRED', ready: false, reason: 'The source is valid but has a bounded finding that requires an explicit operator decision.' });
  if (gate0.status === 'BLOCK') return Object.freeze({ state: 'SECURITY BLOCKED', validationClass: 'SECURITY_BLOCK', ready: false,
    reason: 'Gate 0 blocked the source. Review the safe findings before taking any further action.' });
  return Object.freeze({ state: 'SOURCE READY', validationClass: null, ready: true,
    reason: 'The source decoded successfully and passed the current technical and Gate 0 checks.' });
}

module.exports = { MIN_IDENTITY_SOURCE_EDGE, SOURCE_READINESS_STATES, VALIDATION_CLASSES, sourceReadiness };
