'use strict';

const { AUDIENCE_VERTICALS, AvatarStudioError, PERFORMANCE_PACKS, assertBrandPermission,
  canonicalCharacter, fingerprint, requiredText } = require('./domain');
const { assertGateUsable, inspectGateZero } = require('./gate-zero');
const { evaluateAvatarLevels } = require('./level-engine');
const { compilePlanOnlyTest } = require('./plan-compiler');
const { validateLocationReferenceGeometry } = require('../v2.10.2/reference-geometry');
const { validateAvatarContinuityReadiness } = require('../v2.10/continuity-contract');

function approval(value) {
  const result = String(value || '').toUpperCase();
  if (!['DRAFT','APPROVED','REJECTED'].includes(result)) throw new AvatarStudioError(400, 'APPROVAL_INVALID', 'Approval status is invalid');
  return result;
}

class AvatarStudioService {
  constructor({ repository, actor = 'local-operator' } = {}) {
    if (!repository) throw new Error('AvatarStudioService requires repository');
    this.repository = repository; this.actor = actor;
  }

  async verticals() { return this.repository.verticals(); }
  async list({ brandId, vertical = null } = {}) {
    if (!brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'brandId is required to list avatars');
    if (vertical && !AUDIENCE_VERTICALS.includes(vertical)) throw new AvatarStudioError(400, 'VERTICAL_INVALID', 'Audience vertical is invalid');
    return this.repository.listCharacters({ brandId, vertical });
  }

  async create(input) {
    const character = canonicalCharacter(input);
    if (character.subjectType !== 'SYNTHETIC' && input.humanApproval !== true) {
      throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Real-person identity and consent require explicit human approval');
    }
    const created = await this.repository.createCharacter({ character, identityHash: fingerprint(character.identity), actor: this.actor });
    return this.refresh(created.id);
  }

  async avatar({ id, brandId }) {
    if (!brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'brandId is required');
    const avatar = await this.repository.getCharacter({ id, brandId });
    if (!avatar) throw new AvatarStudioError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found in this brand scope');
    const state = evaluateAvatarLevels(avatar);
    return Object.freeze({ ...avatar, ...state, levelState: state });
  }

  async refresh(id, brandId = null) {
    const avatar = await this.repository.getCharacter({ id, brandId });
    if (!avatar) throw new AvatarStudioError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found');
    const state = evaluateAvatarLevels(avatar);
    await this.repository.saveLevelState({ avatarId: avatar.id, workspaceId: avatar.workspaceId, state });
    return Object.freeze({ ...avatar, ...state, levelState: state });
  }

  async importSource({ avatarId, brandId, source = {} } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId }); assertBrandPermission(avatar, brandId);
    const normalized = { ...source, sourceType: String(source.sourceType || '').toUpperCase() };
    if (!normalized.sourceType) throw new AvatarStudioError(400, 'SOURCE_TYPE_REQUIRED', 'Source type is required');
    const gate0 = inspectGateZero({ ...normalized,
      text: normalized.gate0Text || normalized.text || normalized.sourceLocator || normalized.artifactId,
      metadata: { ...(normalized.metadata || {}), artifactId: normalized.artifactId || null } });
    const registered = await this.repository.registerSource({ avatar, source: normalized, gate0, actor: this.actor });
    return Object.freeze({ source: registered, gate0 });
  }

  async registerPassport({ avatarId, brandId, sourceId, panels, qa = {} } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId });
    const source = await this.repository.source({ id: sourceId, avatarId });
    if (!source) throw new AvatarStudioError(404, 'SOURCE_NOT_FOUND', 'Passport source was not found');
    assertGateUsable(source);
    const angles = new Set((panels || []).map((panel) => panel.angle));
    if (panels?.length !== 3 || angles.size !== 3 || !['FRONTAL','THREE_QUARTER_45','PROFILE_90'].every((angle) => angles.has(angle))) {
      throw new AvatarStudioError(400, 'PASSPORT_ANGLES_INCOMPLETE', 'Passport requires frontal, 45-degree and 90-degree panels');
    }
    for (const panel of panels) {
      requiredText('panel.artifactId', panel.artifactId);
      if (!Number.isInteger(Number(panel.artifactVersion)) || Number(panel.artifactVersion) < 1) throw new AvatarStudioError(400, 'ARTIFACT_VERSION_INVALID', 'Passport panels require immutable artifact versions');
    }
    const passport = await this.repository.registerPassport({ avatar, sourceId, panels, qa, actor: this.actor });
    return Object.freeze({ passport, avatar: await this.refresh(avatar.id, brandId) });
  }

  async certifyPassport({ avatarId, brandId, passportId, decision, notes = null, humanApproval = false } = {}) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval is required to certify a passport');
    const normalized = String(decision || '').toUpperCase();
    if (!['CERTIFIED','REJECTED'].includes(normalized)) throw new AvatarStudioError(400, 'PASSPORT_DECISION_INVALID', 'Passport decision is invalid');
    const avatar = await this.avatar({ id: avatarId, brandId });
    const candidate = avatar.passports.find((item) => item.id === passportId);
    if (!candidate) throw new AvatarStudioError(404, 'PASSPORT_NOT_FOUND', 'Passport candidate was not found');
    if (normalized === 'CERTIFIED' && avatar.passports.some((item) => item.decision === 'CERTIFIED' && item.id !== passportId)) {
      throw new AvatarStudioError(409, 'PASSPORT_ALREADY_CERTIFIED', 'This avatar already has one immutable certified passport');
    }
    if (candidate.decision) throw new AvatarStudioError(409, 'PASSPORT_ALREADY_DECIDED', 'Passport decision is immutable');
    if (candidate.panels.length !== 3) throw new AvatarStudioError(409, 'PASSPORT_ANGLES_INCOMPLETE', 'All passport panels are required before certification');
    const certification = await this.repository.certifyPassport({ avatar, passportId, decision: normalized, notes, actor: this.actor });
    return Object.freeze({ certification, avatar: await this.refresh(avatar.id, brandId) });
  }

  async addLevelAsset({ avatarId, brandId, type, value = {}, humanApproval = false } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId }); const normalizedType = String(type || '').toUpperCase();
    value = { ...value, approvalStatus: approval(value.approvalStatus) };
    if (value.approvalStatus === 'APPROVED' && !humanApproval) {
      throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Approved Avatar Level assets require explicit human approval');
    }
    if (normalizedType === 'VOICE' && value.sourceType !== 'SYNTHETIC') {
      const consent = avatar.consentRecords.find((item) => item.id === value.consentRecordId && item.status === 'APPROVED'
        && ['VOICE','FACE_AND_VOICE'].includes(item.scope));
      if (!consent) throw new AvatarStudioError(409, 'VOICE_CONSENT_REQUIRED', 'Owned or cloned voices require approved immutable voice consent');
    }
    if (normalizedType === 'WARDROBE') {
      value = { ...value, allowedBrandIds: value.allowedBrandIds || [brandId], allowedVerticals: value.allowedVerticals || [avatar.vertical] };
      if (!value.allowedBrandIds.every((id) => avatar.brandIds.includes(id))) throw new AvatarStudioError(403, 'BRAND_ISOLATION_VIOLATION', 'Wardrobe brand scope exceeds avatar permission');
      if (!value.allowedVerticals.every((item) => item === avatar.vertical)) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Wardrobe cannot cross verticals implicitly');
    }
    if (normalizedType === 'LOCATION') {
      const geometry = validateLocationReferenceGeometry(value);
      if (geometry.status !== 'PASS') throw new AvatarStudioError(400, 'LOCATION_GEOMETRY_INVALID', 'Location perspective/light/reference geometry is incomplete', geometry);
      value = { ...value, allowedVerticals: value.allowedVerticals || [avatar.vertical] };
      if (!value.allowedVerticals.every((item) => item === avatar.vertical)) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Location cannot cross verticals implicitly');
    }
    if (normalizedType === 'PERFORMANCE' && !PERFORMANCE_PACKS.includes(value.preset)) throw new AvatarStudioError(400, 'PERFORMANCE_PRESET_INVALID', 'Performance preset is invalid');
    if (normalizedType === 'CONTINUITY') {
      if (!value.continuitySnapshotId) throw new AvatarStudioError(409, 'CONTINUITY_SNAPSHOT_REQUIRED', 'L7 must reference the existing canonical continuity snapshot');
      const continuity = validateAvatarContinuityReadiness(value);
      if (value.approvalStatus === 'APPROVED' && continuity.status !== 'PASS') throw new AvatarStudioError(409, 'CONTINUITY_NOT_READY', 'Every existing continuity family must pass before L7 approval', continuity);
      value = { ...value, evidence: { ...(value.evidence || {}), engine: continuity.engine, checks: continuity.checks } };
    }
    const asset = await this.repository.insertLevelAsset({ avatar, type: normalizedType, value, actor: this.actor });
    return Object.freeze({ asset, avatar: await this.refresh(avatar.id, brandId) });
  }

  async compileTestPlan(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    const reference = await this.repository.source({ id: input.referenceSourceId, avatarId: avatar.id });
    if (!reference) throw new AvatarStudioError(404, 'SOURCE_NOT_FOUND', 'Reference source was not found in this avatar scope');
    const continuity = avatar.continuityReadiness.find((item) => item.approvalStatus === 'APPROVED');
    const planAvatar = { ...avatar, continuityEvidence: continuity ? {
      identity: continuity.identityStatus, wardrobe: continuity.wardrobeStatus, props: continuity.propStatus,
      location: continuity.locationStatus, geometry: continuity.geometryStatus, voice: continuity.voiceStatus, lipSync: continuity.lipSyncStatus,
    } : {} };
    const plan = compilePlanOnlyTest({ avatar: planAvatar, levelState: avatar, vertical: input.vertical,
      brandId: input.brandId, format: input.format, reference, script: input.script, shotPlan: input.shotPlan,
      providerSelection: input.providerSelection, actor: this.actor });
    const stored = await this.repository.storePlan({ avatar, plan, actor: this.actor });
    return Object.freeze({ ...plan, id: stored.id, durable: true });
  }
}

module.exports = { AvatarStudioService, approval };
