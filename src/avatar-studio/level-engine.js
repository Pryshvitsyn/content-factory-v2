'use strict';

const { PERFORMANCE_PACKS } = require('./domain');

const LEVELS = Object.freeze([
  Object.freeze({ level: 0, name: 'IDENTITY' }),
  Object.freeze({ level: 1, name: 'PASSPORT' }),
  Object.freeze({ level: 2, name: 'BODY_EXPRESSIONS' }),
  Object.freeze({ level: 3, name: 'WARDROBE' }),
  Object.freeze({ level: 4, name: 'VOICE' }),
  Object.freeze({ level: 5, name: 'LOCATIONS' }),
  Object.freeze({ level: 6, name: 'PERFORMANCE' }),
  Object.freeze({ level: 7, name: 'MULTISHOT_CONTINUITY' }),
]);

function approved(items = []) { return items.filter((item) => (item.approvalStatus || item.approval_status || item.status) === 'APPROVED'); }
function values(items = [], key) { return new Set(approved(items).map((item) => item[key] || item[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)])); }
function requirement(code, met, failure = null) { return Object.freeze({ code, status: met ? 'COMPLETE' : 'MISSING', ...(failure ? { failure } : {}) }); }
function resolved(value) { return Boolean(String(value || '').trim()) && String(value).toUpperCase() !== 'TO_BE_DEFINED'; }

function evaluateAvatarLevels(avatar = {}) {
  const identity = avatar.identity || avatar.identitySpec || avatar.identity_spec || {};
  const brandPermissions = (avatar.brandPermissions || []).filter((item) => item.allowed !== false);
  const latestFaceEvent = (avatar.consentEvents || []).find((item) => item.modality === 'FACE');
  const consent = avatar.consent || (latestFaceEvent?.status === 'APPROVED' ? latestFaceEvent : null)
    || (avatar.consentRecords || []).find((item) => (item.status || '').toUpperCase() === 'APPROVED');
  const sourceBlocks = (avatar.sources || []).filter((item) => (item.gate0Status || item.gate0_status) === 'BLOCK');
  const currentIdentityVersionId = avatar.identityVersionId || avatar.identity_version_id
    || (avatar.version && (avatar.characterVersionId || avatar.character_version_id));
  const legacyPassportEvidence = (avatar.passports || []).some((item) =>
    (item.certification?.decision || item.decision) === 'CERTIFIED'
      && new Set((item.panels || []).map((panel) => panel.angle)).size === 3);
  const currentIdentityLock = Array.isArray(avatar.identityLocks)
    ? avatar.identityLocks.find((item) => (item.identityVersionId || item.identity_version_id) === currentIdentityVersionId)
      || (!avatar.identityLocks.length && legacyPassportEvidence ? { id: 'LEGACY_CERTIFIED_IDENTITY_BOUNDARY' } : null)
    : { id: 'LEGACY_FIXTURE_COMPATIBILITY' };
  const v12Certification = Array.isArray(avatar.passportCertificationEvents)
    ? avatar.passportCertificationEvents.some((item) => (item.identityVersionId || item.identity_version_id) === currentIdentityVersionId
      && (!currentIdentityLock || (item.identityLockVersionId || item.identity_lock_version_id) === currentIdentityLock.id))
    : false;
  const legacyCertified = (!Array.isArray(avatar.identityLocks) || !avatar.identityLocks.length) && legacyPassportEvidence;
  const passportCertified = v12Certification || legacyCertified;
  const bodyKinds = values(avatar.bodyReferences, 'kind'); const expressionKinds = values(avatar.expressionReferences, 'expression');
  const hasV13Evidence = avatar.l2ContractVersion === 'V1.3' || ['bodyBuildVersions','bodyGenerationSpecs','bodyReferenceCandidates','bodyReferenceCertifications',
    'expressionGenerationSpecs','expressionCandidates','expressionCertifications','mouthCalibrationCandidates','l2PackCertificationEvents']
    .some((key) => Array.isArray(avatar[key]) && avatar[key].length);
  const l2Certified = (avatar.l2PackCertificationEvents || []).some((event) =>
    (event.identityVersionId || event.identity_version_id) === currentIdentityVersionId
      && (event.passportCertificationEventId || event.passport_certification_event_id)
      && (avatar.passportCertificationEvents || []).some((passport) => passport.id ===
        (event.passportCertificationEventId || event.passport_certification_event_id)
        && (passport.identityVersionId || passport.identity_version_id) === currentIdentityVersionId));
  const legacyL2Complete = !hasV13Evidence && bodyKinds.has('CHEST_UP') && bodyKinds.has('FULL_BODY_STANDING')
    && bodyKinds.has('SEATED') && expressionKinds.has('NEUTRAL') && expressionKinds.has('WARM_SMILE')
    && expressionKinds.has('CONCERNED_SERIOUS');
  const continuity = approved(avatar.continuityReadiness || []).find((item) => ['identityStatus','wardrobeStatus','propStatus',
    'locationStatus','geometryStatus','voiceStatus','lipSyncStatus'].every((key) => (item[key] || item[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]) === 'PASS'));

  const definitions = [
    [requirement('IDENTITY_NAME', Boolean(avatar.internalName || avatar.internal_name)),
      requirement('IDENTITY_SUBJECT_TYPE', Boolean(avatar.subjectType || avatar.subject_type)),
      requirement('IDENTITY_VERTICAL', Boolean(avatar.vertical || avatar.verticalCode || avatar.vertical_code)),
      requirement('IDENTITY_AGE_PRESENTATION', resolved(identity.agePresentation)),
      requirement('IDENTITY_PERSONALITY_ROLE', resolved(identity.personality) && resolved(identity.role)),
      requirement('IDENTITY_LANGUAGES', Boolean(identity.languages?.some((item) => String(item).toLowerCase() !== 'und'))),
      requirement('IDENTITY_VISUAL_DIRECTION', resolved(identity.visualDirection)),
      requirement('IDENTITY_PROHIBITED_USES', Boolean(identity.prohibitedUses?.length)),
      requirement('IDENTITY_BRAND_PERMISSION', brandPermissions.length > 0),
      requirement('IDENTITY_CONSENT_RIGHTS', consent?.status === 'APPROVED'),
      requirement('IDENTITY_LOCK_CURRENT_VERSION', Boolean(currentIdentityLock))],
    [requirement('CERTIFIED_PASSPORT_REQUIRED', passportCertified)],
    [requirement('L2_PACK_HUMAN_CERTIFICATION', l2Certified || legacyL2Complete)],
    [requirement('WARDROBE_APPROVED', approved(avatar.wardrobes).length > 0)],
    [requirement('VOICE_APPROVED', approved(avatar.voiceProfiles).length > 0),
      requirement('VOICE_CONSENT', approved(avatar.voiceProfiles).every((voice) => voice.sourceType === 'SYNTHETIC'
        || voice.consentRecordId || voice.consent_record_id || voice.consentEventId || voice.consent_event_id))],
    [requirement('LOCATION_APPROVED', approved(avatar.locations).length > 0),
      requirement('LOCATION_LIGHT_GEOMETRY', approved(avatar.locations).some((item) => (item.referenceGeometry || item.reference_geometry)
        && (item.lightingDirection || item.lighting_direction) && (item.lightingTemperature || item.lighting_temperature)))],
    [requirement('PERFORMANCE_APPROVED', approved(avatar.performancePacks).length > 0),
      requirement('PERFORMANCE_PRESET_VALID', approved(avatar.performancePacks).every((item) => PERFORMANCE_PACKS.includes(item.preset)))],
    [requirement('CONTINUITY_APPROVED', Boolean(continuity)),
      requirement('CONTINUITY_CANONICAL_SNAPSHOT', Boolean(continuity?.continuitySnapshotId || continuity?.continuity_snapshot_id))],
  ];
  const levels = LEVELS.map((level, index) => {
    const requirements = definitions[index]; const complete = requirements.every((item) => item.status === 'COMPLETE');
    return Object.freeze({ ...level, status: complete ? 'COMPLETE' : 'BLOCKED', requirements: Object.freeze(requirements),
      missing: Object.freeze(requirements.filter((item) => item.status !== 'COMPLETE').map((item) => item.code)) });
  });
  let completedLevel = -1;
  for (const level of levels) { if (level.status !== 'COMPLETE') break; completedLevel = level.level; }
  const currentLevel = Math.max(0, completedLevel);
  const blockingFailures = [];
  if (sourceBlocks.length) blockingFailures.push('GATE0_BLOCKED_SOURCE');
  if ((avatar.consentRecords || []).some((item) => ['REVOKED','EXPIRED'].includes(item.status))
    || (avatar.consentEvents || []).some((item) => ['REVOKED','EXPIRED'].includes(item.status))) blockingFailures.push('CONSENT_NOT_VALID');
  if ((avatar.continuityReadiness || []).some((item) => item.approvalStatus === 'REJECTED' || item.approval_status === 'REJECTED')) blockingFailures.push('CONTINUITY_REJECTED');
  const current = levels[currentLevel]; const next = levels[completedLevel + 1] || null;
  return Object.freeze({ currentLevel, currentLevelName: current.name,
    completedRequirements: Object.freeze(levels.slice(0, Math.max(1, completedLevel + 1)).flatMap((item) => item.requirements.filter((r) => r.status === 'COMPLETE').map((r) => r.code))),
    missingRequirements: Object.freeze(next?.missing || []), nextLevel: next ? Object.freeze({ level: next.level, name: next.name }) : null,
    blockingFailures: Object.freeze(blockingFailures), levels: Object.freeze(levels) });
}

module.exports = { LEVELS, evaluateAvatarLevels };
