'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { AvatarStudioError, assertBrandPermission, requiredText, stringList } = require('./domain');
const { inspectAssetGateZero } = require('./gate-zero');
const { decodeBase64, inspectMedia } = require('./media-intake');
const { sourceReadiness } = require('./intake-readiness');

const SOURCE_TYPES = Object.freeze(['UPLOAD','CAMERA','MICROPHONE','EXISTING_ASSET','SAFE_URL_IMPORT']);
const SOURCE_ROLES = Object.freeze(['IDENTITY','PASSPORT_SOURCE','PASSPORT_CANDIDATE','BODY_REFERENCE_CANDIDATE',
  'EXPRESSION_REFERENCE_CANDIDATE','MOUTH_CALIBRATION_CANDIDATE','VOICE_SOURCE','WARDROBE','PRODUCT','LOCATION','STYLE_REFERENCE','PREVIOUS_SHOT']);
const REVIEW_ACTIONS = Object.freeze(['APPROVE_FOR_USE','REJECT','REQUEST_CONSENT','MARK_RIGHTS_VERIFIED','KEEP_BLOCKED']);

function publicIntake(intake) {
  if (!intake) return null;
  const { artifactStorageKey, tokenHash, ...safe } = intake;
  const analysis = intake.provenance?.intakeAnalysis || {};
  const faceConsent = (intake.effectiveConsents || []).some((item) => item.modality === 'FACE' && item.status === 'APPROVED');
  const voiceConsent = (intake.effectiveConsents || []).some((item) => item.modality === 'VOICE' && item.status === 'APPROVED');
  const unresolvedFindings = (intake.gate0Findings || []).filter((item) => {
    if (item.code === 'FACE_CONSENT_REQUIRED' && faceConsent) return false;
    if (item.code === 'VOICE_CONSENT_REQUIRED' && voiceConsent) return false;
    if (item.code === 'PROVENANCE_UNCERTAIN' && intake.effectiveRightsStatus === 'VERIFIED') return false;
    return item.severity === 'BLOCK' || intake.effectiveGate0Status !== 'PASS';
  });
  const readiness = sourceReadiness({ media: { kind: String(intake.mimeType || '').split('/')[0], width: intake.width,
    height: intake.height, findings: unresolvedFindings, ...analysis },
  gate0: { status: intake.effectiveGate0Status, findings: unresolvedFindings } });
  return Object.freeze({ ...safe, previewUrl: `/api/avatar-studio/intakes/${encodeURIComponent(intake.id)}/content?brandId=${encodeURIComponent(intake.brandId)}&avatarId=${encodeURIComponent(intake.characterId)}`,
    sourceReadiness: readiness, paidProviderCalls: 0, externalGenerationCalls: 0 });
}

function roleModalities(roles) {
  const result = new Set();
  if (roles.some((role)=>['IDENTITY','PASSPORT_SOURCE','PASSPORT_CANDIDATE','BODY_REFERENCE_CANDIDATE',
    'EXPRESSION_REFERENCE_CANDIDATE','MOUTH_CALIBRATION_CANDIDATE'].includes(role))) result.add('FACE');
  if (roles.includes('VOICE_SOURCE')) result.add('VOICE');
  return [...result];
}

function roleUseTypes(roles, modality) {
  if (modality !== 'FACE') return [];
  const result = new Set();
  if (roles.includes('IDENTITY')) result.add('AVATAR_IDENTITY');
  if (roles.some((role) => ['PASSPORT_SOURCE','PASSPORT_CANDIDATE','BODY_REFERENCE_CANDIDATE',
    'EXPRESSION_REFERENCE_CANDIDATE','MOUTH_CALIBRATION_CANDIDATE'].includes(role))) result.add('PASSPORT_REFERENCE');
  return [...result];
}

function consentAllows(event, { brandId, vertical, modality, useType = null }) {
  if (!event || event.modality !== modality || event.status !== 'APPROVED' || event.eventType !== 'GRANT') return false;
  if (event.expiresAt && new Date(event.expiresAt) <= new Date()) return false;
  if (!(event.allowedBrandIds || []).includes(brandId) || !(event.allowedVerticals || []).includes(vertical)) return false;
  if (useType && !(event.allowedUseTypes || []).includes(useType)) return false;
  return true;
}

function currentAvatarConsent(avatar, modality) {
  const events = (avatar?.consentEvents || []).filter((item) => item.modality === modality);
  if (events.length) {
    const dated = events.map((event, index) => ({ event, index,
      time: Date.parse(event.recordedAt || event.recorded_at || event.decidedAt || event.createdAt || '') }))
      .filter((item) => Number.isFinite(item.time));
    if (dated.length) {
      dated.sort((left, right) => right.time - left.time || right.index - left.index);
      return dated[0].event;
    }
    return events[events.length - 1];
  }
  if (modality === 'FACE' && avatar?.consent?.modality === 'FACE') return avatar.consent;
  return null;
}

class AvatarAssetIntakeService {
  constructor({ repository, artifactService, storage, mediaInspector = null, safeUrlImporter = null, actor = 'local-operator' } = {}) {
    if (!repository || !artifactService || !storage) throw new Error('AvatarAssetIntakeService requires repository, artifactService and storage');
    this.repository = repository; this.artifactService = artifactService; this.storage = storage;
    this.mediaInspector = mediaInspector; this.safeUrlImporter = safeUrlImporter; this.actor = actor;
  }

  async intake({ avatar, brandId, sourceType, file = null, url = null, existingAssetId = null, provenance = {} } = {}) {
    assertBrandPermission(avatar, brandId, avatar.vertical);
    const normalizedType = String(sourceType || '').toUpperCase();
    if (!SOURCE_TYPES.includes(normalizedType)) throw new AvatarStudioError(400, 'INTAKE_SOURCE_TYPE_INVALID', 'Choose an explicit asset intake source');
    let bytes; let filename; let mimeType; let sourceLocator = null; let existing = null; let importExternalCalls = 0;
    if (normalizedType === 'EXISTING_ASSET') {
      existing = await this.repository.existingAsset({ id: existingAssetId, brandId, workspaceId: avatar.workspaceId });
      if (!existing) throw new AvatarStudioError(404, 'EXISTING_ASSET_NOT_FOUND', 'Existing artifact was not found in this brand/workspace scope');
      bytes = await this.storage.get({ key: existing.storageKey });
      mimeType = existing.metadata?.contentType || ({ image: 'image/png', video: 'video/mp4', voice: 'audio/mpeg', audio: 'audio/mpeg' })[existing.kind]
        || 'application/octet-stream';
      filename = existing.metadata?.filename || `${existing.artifactId}${({ 'image/png': '.png', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' })[mimeType] || '.bin'}`;
      sourceLocator = `artifact://${existing.artifactId}/v${existing.artifactVersion}`;
      provenance = { ...existing.metadata, ...provenance, source: 'V2_1_ASSET_REGISTRY', registryId: existing.id };
    } else if (normalizedType === 'SAFE_URL_IMPORT') {
      if (!this.safeUrlImporter) throw new AvatarStudioError(503, 'SAFE_URL_IMPORT_UNAVAILABLE', 'Safe URL import is not configured');
      const imported = await this.safeUrlImporter.fetch(url);
      ({ bytes, filename, mimeType, sourceLocator } = imported); importExternalCalls = imported.externalCalls;
      provenance = { ...provenance, source: 'EXPLICIT_SAFE_URL_IMPORT', originalUrl: sourceLocator };
    } else {
      filename = requiredText('file.name', file?.name); mimeType = requiredText('file.mimeType', file?.mimeType);
      bytes = decodeBase64(file?.contentBase64);
      sourceLocator = `${normalizedType.toLowerCase()}://${filename}`;
      provenance = { ...provenance, source: normalizedType, browserCapturedAt: file?.capturedAt || null };
    }
    const media = await inspectMedia({ bytes, filename, mimeType, mediaInspector: this.mediaInspector });
    const completeMedia = { ...media, filename };
    const faceConsent = currentAvatarConsent(avatar, 'FACE');
    const voiceConsent = currentAvatarConsent(avatar, 'VOICE');
    const faceConsentVerified = avatar.subjectType === 'SYNTHETIC' || consentAllows(faceConsent,
      { brandId, vertical: avatar.vertical, modality: 'FACE' });
    const voiceConsentVerified = avatar.subjectType === 'SYNTHETIC' || consentAllows(voiceConsent,
      { brandId, vertical: avatar.vertical, modality: 'VOICE' });
    const gate0 = inspectAssetGateZero({ media: completeMedia, sourceType: normalizedType, sourceLocator, provenance,
      subjectType: avatar.subjectType, consentVerified: faceConsentVerified, voiceConsentVerified,
      visualOnly: provenance.visualOnly === true });
    const readiness = sourceReadiness({ media: completeMedia, gate0 });
    const intakeId = crypto.randomUUID(); let artifact;
    if (existing) artifact = { artifactId: existing.artifactId, version: existing.artifactVersion, storageKey: existing.storageKey,
      contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    else artifact = await this.artifactService.createVersion({
      artifactId: `avatar-source-${avatar.workspaceId}-${brandId}-${intakeId}`, type: 'binary', content: bytes,
      stageId: 'AVATAR_ASSET_INTAKE', attemptId: intakeId, provider: 'local-intake', model: 'none', validationStatus: gate0.status,
    });
    const rightsStatus = avatar.subjectType === 'SYNTHETIC' ? 'NOT_REQUIRED' : 'UNKNOWN';
    const stored = await this.repository.createIntake({ id: intakeId, avatar, brandId, artifact,
      media: completeMedia, sourceType: normalizedType, sourceLocator, existingAssetId: existing?.id, gate0, rightsStatus,
      provenance: { ...provenance, intakeAnalysis: { detectedMime: media.detectedMime, width: media.width, height: media.height,
        orientation: media.orientation, rotation: media.rotation, byteSize: media.byteSize, encoding: media.encoding,
        metadataParser: media.metadataParser, readiness },
        artifactService: 'CONTENT_FACTORY_IMMUTABLE_ARTIFACT_V1', uploader: this.actor,
        importedAt: new Date().toISOString(), originalFilename: filename }, actor: this.actor });
    const publicAsset = publicIntake(stored);
    return Object.freeze({ asset: publicAsset, gate0: { ...gate0, externalCalls: importExternalCalls,
      paidProviderCalls: 0, externalGenerationCalls: 0 }, sourceReadiness: readiness,
      mediaAnalysis: Object.freeze({ originalFilename: filename, declaredMime: mimeType, detectedMime: media.detectedMime,
        width: media.width, height: media.height, orientation: media.orientation, byteSize: media.byteSize,
        encoding: media.encoding, metadataParser: media.metadataParser }), eligibility: this.eligibility(stored, avatar, []) });
  }

  async ingestProviderOutput({ avatar, brandId, bytes, filename, mimeType, provider, model, attemptId,
    providerRequestId = null, provenance = {}, consentVerified = false } = {}) {
    assertBrandPermission(avatar, brandId, avatar.vertical);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new AvatarStudioError(502, 'PROVIDER_OUTPUT_INVALID',
      'Provider returned no decodable image bytes');
    const media = await inspectMedia({ bytes, filename, mimeType, mediaInspector: this.mediaInspector });
    const completeMedia = { ...media, filename };
    if (media.kind !== 'image' || media.findings.some((item) => item.severity === 'BLOCK') || !media.width || !media.height) {
      throw new AvatarStudioError(502, 'PROVIDER_OUTPUT_INVALID', 'Provider output failed MIME, decode or dimension validation',
        { findings: media.findings, width: media.width, height: media.height });
    }
    const derivedProvenance = { ...provenance, source: 'APPROVED_PROVIDER_EXECUTION', provider, model };
    const gate0 = inspectAssetGateZero({ media: completeMedia, sourceType: 'PROVIDER_OUTPUT',
      sourceLocator: `provider://${provider}/response`, provenance: derivedProvenance,
      subjectType: avatar.subjectType, consentVerified });
    if (gate0.status !== 'PASS') throw new AvatarStudioError(409, 'SECURITY_REJECTED_OUTPUT',
      `Provider output was rejected by Gate 0 with ${gate0.status}`, { status: gate0.status, findings: gate0.findings });
    const intakeId = crypto.randomUUID();
    const artifact = await this.artifactService.createVersion({
      artifactId: `avatar-passport-${avatar.workspaceId}-${brandId}-${intakeId}`, type: 'binary', content: bytes,
      stageId: 'AVATAR_PASSPORT_PROVIDER_OUTPUT', attemptId,
      idempotencyKey: `avatar-passport:${attemptId}`, provider, model, validationStatus: gate0.status,
    });
    const stored = await this.repository.createIntake({ id: intakeId, avatar, brandId, artifact,
      media: completeMedia, sourceType: 'PROVIDER_OUTPUT', sourceLocator: `provider://${provider}/${providerRequestId || attemptId}`,
      existingAssetId: null, gate0, rightsStatus: avatar.subjectType === 'SYNTHETIC' ? 'NOT_REQUIRED' : 'VERIFIED',
      provenance: { ...derivedProvenance, providerRequestId,
        attemptId, artifactService: 'CONTENT_FACTORY_IMMUTABLE_ARTIFACT_V1', importedAt: new Date().toISOString() },
      actor: this.actor });
    return Object.freeze({ asset: publicIntake(stored), artifact, gate0 });
  }

  eligibility(intake, avatar, roles) {
    const failures = [];
    if (intake.effectiveGate0Status !== 'PASS') failures.push(intake.effectiveGate0Status === 'BLOCK' ? 'GATE0_BLOCKED' : 'GATE0_REVIEW_REQUIRED');
    if (avatar.subjectType !== 'SYNTHETIC') {
      const modalities = roleModalities(roles);
      for (const modality of modalities) {
        const events = [...(intake.effectiveConsents || [])];
        const avatarEvent = currentAvatarConsent(avatar, modality);
        if (avatarEvent && !events.some((item) => item.id === avatarEvent.id)) events.push(avatarEvent);
        const useTypes = roleUseTypes(roles, modality);
        const allowed = useTypes.length
          ? useTypes.every((useType) => events.some((event) => consentAllows(event,
            { brandId: intake.brandId, vertical: intake.verticalCode, modality, useType })))
          : events.some((event) => consentAllows(event, { brandId: intake.brandId, vertical: intake.verticalCode, modality }));
        if (!allowed) failures.push(`${modality}_CONSENT_REQUIRED`);
      }
      if (!modalities.length && intake.effectiveRightsStatus !== 'VERIFIED') failures.push('RIGHTS_VERIFICATION_REQUIRED');
    }
    return Object.freeze({ eligible: failures.length === 0, failures: Object.freeze(failures), roles: Object.freeze([...roles]) });
  }

  async list({ avatar, brandId, reviewOnly = false }) {
    assertBrandPermission(avatar, brandId, avatar.vertical);
    const rows = await this.repository.listIntakes({ brandId, avatarId: reviewOnly ? null : avatar.id, reviewOnly });
    return rows.map(publicIntake);
  }

  async reviewQueue({ brandId }) {
    if (!brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'brandId is required for the Gate 0 review queue');
    return (await this.repository.listIntakes({ brandId, avatarId: null, reviewOnly: true })).map(publicIntake);
  }

  async existingAssets({ avatar, brandId }) {
    assertBrandPermission(avatar, brandId, avatar.vertical);
    const assets = await this.repository.listExistingAssets({ brandId, workspaceId: avatar.workspaceId });
    return assets.map(({ storageKey, ...item }) => item);
  }

  async review({ avatar, brandId, intakeId, action, reason, humanApproval = false }) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Gate 0 review requires explicit human approval');
    const normalized = String(action || '').toUpperCase();
    if (!REVIEW_ACTIONS.includes(normalized)) throw new AvatarStudioError(400, 'GATE0_REVIEW_ACTION_INVALID', 'Choose a supported Gate 0 review action');
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    if (intake.gate0Status === 'BLOCK' && normalized === 'APPROVE_FOR_USE') {
      throw new AvatarStudioError(409, 'GATE0_BLOCK_IMMUTABLE', 'A Gate 0 BLOCK cannot be approved for use');
    }
    if (normalized === 'APPROVE_FOR_USE' && intake.gate0Status !== 'REVIEW') {
      throw new AvatarStudioError(409, 'GATE0_REVIEW_NOT_REQUIRED', 'Only REVIEW assets can be explicitly approved');
    }
    const event = await this.repository.addReviewEvent({ intake, action: normalized, reason: requiredText('reason', reason), actor: this.actor });
    return Object.freeze({ event, asset: publicIntake(await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id })) });
  }

  async createConsentRequest({ avatar, brandId, intakeId, modality, disclosureText, expiresAt = null }) {
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    const normalized = String(modality || '').toUpperCase();
    if (!['FACE','VOICE'].includes(normalized)) throw new AvatarStudioError(400, 'CONSENT_MODALITY_INVALID', 'Consent modality must be FACE or VOICE');
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) throw new AvatarStudioError(400, 'CONSENT_EXPIRY_INVALID', 'Consent request expiry must be in the future');
    const request = await this.repository.createConsentRequest({ intake, modality: normalized, tokenHash,
      disclosureText: requiredText('disclosureText', disclosureText), expiresAt: expiry, actor: this.actor });
    return Object.freeze({ request, token: rawToken, consentPath: `/avatar-consent/${request.id}?token=${rawToken}`,
      delivery: 'COPY_LINK_OR_QR_FOUNDATION', externalCalls: 0, paidProviderCalls: 0 });
  }

  async grantConsent({ avatar, brandId, intakeId, modality, subjectIdentity, rightsBasis, allowedBrandIds,
    allowedVerticals, allowedChannels, allowedUseTypes, evidenceArtifactId = null, evidenceArtifactVersion = null,
    evidenceIntakeId = null, evidenceNotes = null, expiresAt = null, disclosureAccepted = false, humanApproval = false, requestId = null }) {
    if (!humanApproval || !disclosureAccepted) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Consent disclosure and explicit human approval are required');
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    const normalized = String(modality || '').toUpperCase();
    if (!['FACE','VOICE'].includes(normalized)) throw new AvatarStudioError(400, 'CONSENT_MODALITY_INVALID', 'Consent modality must be FACE or VOICE');
    if (!subjectIdentity || typeof subjectIdentity !== 'object'
      || !Object.values(subjectIdentity).some((value) => String(value || '').trim())) throw new AvatarStudioError(400,
      'CONSENT_SUBJECT_REQUIRED', 'Record the consenting person identity');
    const brands = stringList('allowedBrandIds', allowedBrandIds, { required: true });
    const verticals = stringList('allowedVerticals', allowedVerticals, { required: true });
    if (!brands.includes(brandId) || brands.some((id) => !avatar.brandIds.includes(id))) throw new AvatarStudioError(403, 'BRAND_ISOLATION_VIOLATION', 'Consent brand scope exceeds avatar permissions');
    if (!verticals.includes(avatar.vertical) || verticals.some((value) => value !== avatar.vertical)) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Consent cannot silently cross audience verticals');
    if (evidenceIntakeId) {
      const evidence = await this.repository.intake({ id: evidenceIntakeId, brandId, avatarId: avatar.id });
      if (!evidence) throw new AvatarStudioError(404, 'CONSENT_EVIDENCE_NOT_FOUND', 'Consent evidence intake was not found in this avatar scope');
      if (evidence.effectiveGate0Status !== 'PASS') throw new AvatarStudioError(409, 'CONSENT_EVIDENCE_GATE0_REQUIRED', 'Consent evidence must pass explicit Gate 0 review');
      if (!['audio','video'].includes(String(evidence.mimeType).split('/')[0])) throw new AvatarStudioError(400,
        'CONSENT_EVIDENCE_MEDIA_INVALID', 'Local consent evidence must be an immutable audio or video asset');
      evidenceArtifactId = evidence.artifactId; evidenceArtifactVersion = evidence.artifactVersion;
    }
    if (!evidenceNotes && (!evidenceArtifactId || !evidenceArtifactVersion)) throw new AvatarStudioError(400, 'CONSENT_EVIDENCE_REQUIRED', 'Record immutable evidence or explicit consent evidence notes');
    let normalizedExpiry = null;
    if (expiresAt) { normalizedExpiry = new Date(expiresAt); if (!Number.isFinite(normalizedExpiry.getTime()) || normalizedExpiry <= new Date()) {
      throw new AvatarStudioError(400, 'CONSENT_EXPIRY_INVALID', 'Consent expiry must be in the future');
    } }
    if (evidenceArtifactVersion != null && (!Number.isInteger(Number(evidenceArtifactVersion)) || Number(evidenceArtifactVersion) < 1)) {
      throw new AvatarStudioError(400, 'CONSENT_EVIDENCE_VERSION_INVALID', 'Consent evidence requires a positive immutable version');
    }
    const event = await this.repository.addConsentEvent({ intake, requestId, modality: normalized, eventType: 'GRANT', status: 'APPROVED',
      subjectIdentity: subjectIdentity || {}, rightsBasis: requiredText('rightsBasis', rightsBasis), allowedBrandIds: brands,
      allowedVerticals: verticals, allowedChannels: stringList('allowedChannels', allowedChannels, { required: true }),
      allowedUseTypes: stringList('allowedUseTypes', allowedUseTypes, { required: true }), evidenceArtifactId,
      evidenceArtifactVersion: evidenceArtifactVersion ? Number(evidenceArtifactVersion) : null, evidenceNotes, expiresAt: normalizedExpiry, actor: this.actor });
    return Object.freeze({ event, asset: publicIntake(await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id })) });
  }

  async revokeConsent({ avatar, brandId, intakeId, modality, reason, humanApproval = false }) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Consent revocation requires explicit human approval');
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    const normalized = String(modality || '').toUpperCase();
    const current = intake.effectiveConsents.find((item) => item.modality === normalized && item.status === 'APPROVED');
    if (!current) throw new AvatarStudioError(409, 'CONSENT_GRANT_NOT_FOUND', 'No active consent grant exists for this modality');
    const event = await this.repository.addConsentEvent({ intake, modality: normalized, eventType: 'REVOKE', status: 'REVOKED',
      subjectIdentity: current.subjectIdentity, rightsBasis: `REVOKED: ${requiredText('reason', reason)}`,
      allowedBrandIds: current.allowedBrandIds, allowedVerticals: current.allowedVerticals,
      allowedChannels: current.allowedChannels, allowedUseTypes: current.allowedUseTypes,
      evidenceNotes: reason, supersedesEventId: current.id, actor: this.actor });
    return Object.freeze({ event, asset: publicIntake(await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id })) });
  }

  async use({ avatar, brandId, intakeId, roles }) {
    const normalizedRoles = stringList('roles', roles, { required: true }).map((role) => role.toUpperCase());
    if (normalizedRoles.some((role) => !SOURCE_ROLES.includes(role))) throw new AvatarStudioError(400, 'SOURCE_ROLE_INVALID', 'Every source role must be explicit and supported');
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    const eligibility = this.eligibility(intake, avatar, normalizedRoles);
    if (!eligibility.eligible) throw new AvatarStudioError(409, 'ASSET_NOT_ELIGIBLE', 'Asset cannot be used as an avatar source', eligibility);
    const source = await this.repository.useIntake({ avatar, intake, roles: normalizedRoles, actor: this.actor });
    return Object.freeze({ source, eligibility, paidProviderCalls: 0, externalGenerationCalls: 0 });
  }

  async content({ avatar, brandId, intakeId }) {
    const intake = await this.repository.intake({ id: intakeId, brandId, avatarId: avatar.id });
    if (!intake) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
    return { bytes: await this.storage.get({ key: intake.artifactStorageKey }), contentType: intake.mimeType,
      filename: path.basename(intake.originalFilename) };
  }
}

module.exports = { AvatarAssetIntakeService, REVIEW_ACTIONS, SOURCE_ROLES, SOURCE_TYPES, consentAllows, currentAvatarConsent,
  publicIntake, roleModalities, roleUseTypes };
