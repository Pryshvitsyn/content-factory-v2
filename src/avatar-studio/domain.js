'use strict';

const crypto = require('node:crypto');

const AUDIENCE_VERTICALS = Object.freeze([
  'PSYCHOLOGY_WELLBEING', 'CONSTRUCTION_RENOVATION', 'LUXURY_LIFESTYLE', 'TRAVEL',
]);
const SUBJECT_TYPES = Object.freeze(['SYNTHETIC','FOUNDER','CONSENTED_REAL_PERSON','APPROVED_CHARACTER']);
const PERFORMANCE_PACKS = Object.freeze([
  'CALM_EXPERT','ENERGETIC_WARM','QUIET_FRIENDLY','FIRM_DIRECT','WALKING_VLOGGER','PRODUCT_DEMO','REACTION',
]);
const TEMPORARY_IDENTITY_KEYS = Object.freeze([
  'wardrobe','clothing','outfit','accessories','props','environment','background','location','logos','hat',
]);
const IDENTITY_FIELDS = Object.freeze([
  'agePresentation','personality','role','languages','visualDirection','permanentAttributes','prohibitedUses',
]);

class AvatarStudioError extends Error {
  constructor(status, code, message, details = null) {
    super(message); this.name = 'AvatarStudioError'; this.status = status; this.code = code; this.details = details;
  }
}

function requiredText(name, value) {
  const result = String(value || '').trim();
  if (!result) throw new AvatarStudioError(400, 'AVATAR_INPUT_INVALID', `${name} is required`);
  return result;
}

function stringList(name, value, { required = false } = {}) {
  const list = Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];
  if (required && !list.length) throw new AvatarStudioError(400, 'AVATAR_INPUT_INVALID', `${name} requires at least one value`);
  return Object.freeze(list);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function canonicalIdentity(input = {}) {
  const forbidden = Object.keys(input).filter((key) => TEMPORARY_IDENTITY_KEYS.includes(key));
  if (forbidden.length) throw new AvatarStudioError(400, 'IDENTITY_TEMPORARY_ELEMENT_REJECTED',
    'Wardrobe, accessories, props and environment are separate from permanent identity', { forbidden });
  const identity = Object.freeze({
    agePresentation: requiredText('agePresentation', input.agePresentation),
    personality: requiredText('personality', input.personality),
    role: requiredText('role', input.role),
    languages: stringList('languages', input.languages, { required: true }),
    visualDirection: requiredText('visualDirection', input.visualDirection),
    permanentAttributes: Object.freeze({ ...(input.permanentAttributes || {}) }),
    prohibitedUses: stringList('prohibitedUses', input.prohibitedUses, { required: true }),
  });
  return identity;
}

function canonicalCharacter(input = {}) {
  const vertical = String(input.vertical || input.verticalCode || '').toUpperCase();
  const subjectType = String(input.subjectType || '').toUpperCase();
  if (!AUDIENCE_VERTICALS.includes(vertical)) throw new AvatarStudioError(400, 'VERTICAL_INVALID', 'Choose a supported audience vertical');
  if (!SUBJECT_TYPES.includes(subjectType)) throw new AvatarStudioError(400, 'SUBJECT_TYPE_INVALID', 'Choose a supported avatar subject type');
  const brandIds = stringList('brandIds', input.brandIds, { required: true });
  const consent = Object.freeze({
    status: String(input.consent?.status || (subjectType === 'SYNTHETIC' ? 'APPROVED' : '')).toUpperCase(),
    rightsBasis: requiredText('consent.rightsBasis', input.consent?.rightsBasis
      || (subjectType === 'SYNTHETIC' ? 'SYNTHETIC_IDENTITY' : '')),
    evidenceArtifactId: input.consent?.evidenceArtifactId || null,
    evidenceArtifactVersion: input.consent?.evidenceArtifactVersion || null,
    restrictions: stringList('consent.restrictions', input.consent?.restrictions),
  });
  if (consent.status !== 'APPROVED') throw new AvatarStudioError(409, 'CONSENT_REQUIRED', 'Approved face/identity consent is required at L0');
  if (subjectType !== 'SYNTHETIC' && (!consent.evidenceArtifactId || !consent.evidenceArtifactVersion)) {
    throw new AvatarStudioError(409, 'CONSENT_EVIDENCE_REQUIRED', 'Real-person avatars require immutable consent evidence');
  }
  return Object.freeze({
    internalName: requiredText('internalName', input.internalName), vertical, subjectType, brandIds,
    intendedChannels: stringList('intendedChannels', input.intendedChannels),
    identity: canonicalIdentity(input.identity || input),
    consent,
    provenance: Object.freeze({ ...(input.provenance || {}), source: input.provenance?.source || 'OPERATOR_INPUT' }),
  });
}

function assertIdentityContinuity(baseline, candidate) {
  const left = canonicalIdentity(baseline); const right = canonicalIdentity(candidate);
  const changed = IDENTITY_FIELDS.filter((field) => fingerprint(left[field]) !== fingerprint(right[field]));
  return Object.freeze({ status: changed.length ? 'FAIL' : 'PASS', changedFields: Object.freeze(changed),
    ignoredTemporaryElements: TEMPORARY_IDENTITY_KEYS });
}

function assertBrandPermission(avatar, brandId, vertical = null) {
  if (!avatar || !brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'Avatar and brand scope are required');
  if (vertical && avatar.vertical !== vertical && avatar.verticalCode !== vertical) {
    throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Avatar and content plan must use the same audience vertical');
  }
  const allowed = avatar.brandIds || avatar.allowedBrandIds || avatar.brandPermissions?.filter((item) => item.allowed).map((item) => item.brandId) || [];
  if (!allowed.includes(brandId)) throw new AvatarStudioError(403, 'BRAND_ISOLATION_VIOLATION', 'Avatar is not approved for this brand');
  return true;
}

module.exports = { AUDIENCE_VERTICALS, AvatarStudioError, IDENTITY_FIELDS, PERFORMANCE_PACKS, SUBJECT_TYPES,
  TEMPORARY_IDENTITY_KEYS, assertBrandPermission, assertIdentityContinuity, canonicalCharacter, canonicalIdentity,
  fingerprint, requiredText, stable, stringList };
