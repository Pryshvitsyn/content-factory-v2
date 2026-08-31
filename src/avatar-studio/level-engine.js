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
  const passportCertified = (avatar.passports || []).some((item) => (item.certification?.decision || item.decision) === 'CERTIFIED'
    && new Set((item.panels || []).map((panel) => panel.angle)).size === 3);
  const bodyKinds = values(avatar.bodyReferences, 'kind'); const expressionKinds = values(avatar.expressionReferences, 'expression');
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
      requirement('IDENTITY_CONSENT_RIGHTS', consent?.status === 'APPROVED')],
    [requirement('PASSPORT_CERTIFIED', passportCertified)],
    [requirement('BODY_CHEST_UP', bodyKinds.has('CHEST_UP')), requirement('BODY_FULL_STANDING', bodyKinds.has('FULL_BODY_STANDING')),
      requirement('BODY_SEATED', bodyKinds.has('SEATED')), requirement('EXPRESSION_NEUTRAL', expressionKinds.has('NEUTRAL')),
      requirement('EXPRESSION_WARM', expressionKinds.has('WARM_SMILE')), requirement('EXPRESSION_SERIOUS', expressionKinds.has('CONCERNED_SERIOUS'))],
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
