'use strict';

const crypto = require('node:crypto');
const { canonicalVoice, fingerprint } = require('./creative-contract');

const ALLOWED_AUDIO = Object.freeze({
  'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'audio/x-m4a': 'M4A',
});
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const ATTESTATION = 'The uploaded narration matches the approved spoken copy.';

function voiceConfigurationFingerprint(input) {
  const voice = canonicalVoice(input);
  return fingerprint({ sourceType: voice.sourceType, provider: voice.provider, model: voice.model, voiceId: voice.voiceId,
    instructions: voice.instructions, language: voice.language, uploadedArtifactId: voice.uploadedArtifactId });
}
function previewFingerprint(input, previewText) {
  const voice = canonicalVoice(input);
  return fingerprint({ provider: voice.provider, model: voice.model, voiceId: voice.voiceId, instructions: voice.instructions,
    language: voice.language, previewTextHash: crypto.createHash('sha256').update(String(previewText || '')).digest('hex') });
}
function validateConsent(input) {
  const voice = canonicalVoice(input);
  if (voice.sourceType !== 'PROVIDER_CUSTOM') return { status: 'PASS' };
  const consent = voice.consent;
  const pass = consent?.required === true && consent.confirmed === true
    && ['SELF', 'THIRD_PARTY'].includes(consent.ownerRelationship) && consent.confirmedAt && consent.actor;
  return { status: pass ? 'PASS' : 'FAIL', reason: pass ? null : 'Custom or cloned voices require explicit, attributable consent evidence.' };
}
function applyVoiceChange(previous, next) {
  const normalized = canonicalVoice(next);
  const unchanged = voiceConfigurationFingerprint(previous) === voiceConfigurationFingerprint(normalized);
  return canonicalVoice({ ...normalized, approved: unchanged && previous?.approved,
    approvedConfigurationFingerprint: unchanged ? previous?.approvedConfigurationFingerprint : null,
    previewArtifact: unchanged ? previous?.previewArtifact : null });
}
function approveVoice(input) {
  const voice = canonicalVoice(input);
  if (validateConsent(voice).status === 'FAIL') throw Object.assign(new Error('Voice consent is incomplete'), { code: 'VOICE_CONSENT_REQUIRED' });
  if (voice.sourceType !== 'UPLOADED_AUDIO' && !voice.previewArtifact?.artifactId) throw Object.assign(new Error('An exact voice preview must be approved'), { code: 'VOICE_PREVIEW_REQUIRED' });
  if (voice.sourceType === 'UPLOADED_AUDIO' && !voice.uploadedArtifactId) throw Object.assign(new Error('Uploaded voice artifact is required'), { code: 'VOICE_UPLOAD_REQUIRED' });
  return canonicalVoice({ ...voice, approved: true, approvedConfigurationFingerprint: voiceConfigurationFingerprint(voice) });
}
function validateUploadedAudio({ contentType, size, metadata, operatorAttestation }) {
  const checks = {
    FILE_TYPE: Boolean(ALLOWED_AUDIO[contentType]), SIZE: Number(size) > 0 && Number(size) <= MAX_AUDIO_BYTES,
    DURATION: Number(metadata?.durationSeconds) > 0, DECODABLE: metadata?.decodable === true,
    AUDIO_STREAM: metadata?.hasAudio === true, SAMPLE_RATE: Number(metadata?.sampleRate) >= 8000,
    CHANNEL_COUNT: Number(metadata?.channels) >= 1 && Number(metadata?.channels) <= 8,
    OPERATOR_ATTESTATION: operatorAttestation?.confirmed === true && operatorAttestation?.text === ATTESTATION
      && Boolean(operatorAttestation?.actor) && Boolean(operatorAttestation?.confirmedAt),
  };
  return Object.freeze({ status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', format: ALLOWED_AUDIO[contentType] || null, checks: Object.freeze(checks) });
}
function validateVoiceTiming({ voice, targetDurationSeconds, availableDurationSeconds = targetDurationSeconds, toleranceSeconds = 0 } = {}) {
  const normalized = canonicalVoice(voice);
  const duration = Number(normalized.previewArtifact?.durationSeconds || normalized.previewArtifact?.metadata?.durationSeconds || 0);
  const available = Number(availableDurationSeconds);
  const approved = normalized.approved && normalized.approvedConfigurationFingerprint === voiceConfigurationFingerprint(normalized);
  const checks = [
    { name: 'VOICE_DURATION_AVAILABLE', status: duration > 0 ? 'PASS' : 'FAIL' },
    { name: 'VOICE_FITS_MASTER', status: duration <= available + Number(toleranceSeconds || 0) ? 'PASS' : 'FAIL' },
    { name: 'VOICE_NOT_CUTOFF', status: duration <= Number(targetDurationSeconds) + Number(toleranceSeconds || 0) ? 'PASS' : 'FAIL' },
    { name: 'VOICE_APPROVED', status: approved ? 'PASS' : 'FAIL' },
  ];
  return Object.freeze({ status: checks.some((check) => check.status === 'FAIL') ? 'BLOCKED' : 'READY', durationSeconds: duration, availableDurationSeconds: available, checks: Object.freeze(checks) });
}

class VoicePreviewService {
  constructor({ repository, providerGateway, mediaInspector = null }) {
    this.repository = repository; this.providerGateway = providerGateway; this.mediaInspector = mediaInspector;
  }
  async generate({ workspaceId, brandId, voice, previewText, confirmed }) {
    if (!confirmed) throw Object.assign(new Error('Explicit preview confirmation is required'), { code: 'EXPLICIT_CONFIRMATION_REQUIRED' });
    const normalized = canonicalVoice(voice);
    if (normalized.sourceType === 'UPLOADED_AUDIO') throw Object.assign(new Error('Uploaded audio uses local preview and makes no speech call'), { code: 'UPLOADED_AUDIO_LOCAL_PREVIEW' });
    if (validateConsent(normalized).status === 'FAIL') throw Object.assign(new Error('Voice consent is incomplete'), { code: 'VOICE_CONSENT_REQUIRED' });
    const text = String(previewText || '').trim();
    if (!text) throw Object.assign(new Error('Voice preview text is required'), { code: 'VOICE_PREVIEW_TEXT_REQUIRED' });
    const key = previewFingerprint(normalized, text);
    const existing = await this.repository.findVoicePreview({ workspaceId, brandId, fingerprint: key });
    if (existing) return Object.freeze({ artifact: normalizePreviewArtifact(existing), externalCalls: 0, reused: true });
    let generated = await this.providerGateway.generatePreview({ voice: normalized, text, idempotencyKey: key });
    if (!Buffer.isBuffer(generated?.bytes) || !generated.bytes.length) throw Object.assign(new Error('Voice preview provider returned no durable audio bytes'), { code: 'VOICE_PREVIEW_INVALID' });
    if (!(Number(generated.durationSeconds) > 0)) {
      if (!this.mediaInspector) throw Object.assign(new Error('Voice preview duration cannot be certified'), { code: 'VOICE_PREVIEW_INSPECTOR_REQUIRED' });
      const probe = await this.mediaInspector.inspect({ bytes: generated.bytes, contentType: generated.contentType || 'audio/mpeg', kind: 'voice' });
      if (!probe?.hasAudio || !(Number(probe.durationMs) > 0)) throw Object.assign(new Error('Voice preview is not decodable audio'), { code: 'VOICE_PREVIEW_INVALID' });
      generated = { ...generated, durationSeconds: Number(probe.durationMs) / 1000,
        provenance: { ...(generated.provenance || {}), previewProbe: probe } };
    }
    const artifact = await this.repository.storeVoicePreview({ workspaceId, brandId, fingerprint: key, voice: normalized,
      previewTextHash: crypto.createHash('sha256').update(text).digest('hex'), ...generated });
    return Object.freeze({ artifact: normalizePreviewArtifact(artifact), externalCalls: 1, reused: false });
  }
}

function normalizePreviewArtifact(artifact) {
  return Object.freeze({ ...artifact, artifactId: artifact.artifactId || artifact.id,
    durationSeconds: Number(artifact.durationSeconds || artifact.duration_seconds || 0),
    contentHash: artifact.contentHash || artifact.content_hash, storageKey: artifact.storageKey || artifact.storage_key });
}

module.exports = { ALLOWED_AUDIO, MAX_AUDIO_BYTES, ATTESTATION, VoicePreviewService, applyVoiceChange, approveVoice,
  normalizePreviewArtifact, previewFingerprint, validateConsent, validateUploadedAudio, validateVoiceTiming, voiceConfigurationFingerprint };
