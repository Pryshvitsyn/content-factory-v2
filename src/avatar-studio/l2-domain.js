'use strict';

const { AvatarStudioError, fingerprint } = require('./domain');
const { estimateOpenAIImagePlan } = require('../v2.9.2/pricing-registry');

const BODY_REFERENCE_TYPES = Object.freeze(['CHEST_UP_NEUTRAL','FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL']);
const EXPRESSION_TYPES = Object.freeze(['NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED','ENERGETIC_POSITIVE']);
const REQUIRED_EXPRESSIONS = Object.freeze(['NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED']);
const MOUTH_STATES = Object.freeze(['NEUTRAL_CLOSED','SOFT_SMILE','VISIBLE_TEETH','OOH','AAH','EE','MM_CLOSED']);
const REQUIRED_MOUTH_STATES = Object.freeze(['NEUTRAL_CLOSED','SOFT_SMILE','VISIBLE_TEETH','OOH','AAH']);
const L2_REJECTION_REASONS = Object.freeze(['IDENTITY_DRIFT','AGE_DRIFT','BODY_BUILD_DRIFT','FACE_CHANGED','NOSE_CHANGED',
  'JAW_CHANGED','HAIR_CHANGED','HAND_FAILURE','FINGER_FAILURE','LIMB_FAILURE','FOOT_FAILURE','POSTURE_FAILURE',
  'SEATED_CONTACT_FAILURE','EXPRESSION_WRONG','EXPRESSION_OVERDONE','TEETH_CHANGED','MOUTH_GEOMETRY_FAILURE',
  'WARDROBE_CONTAMINATION','ACCESSORY_CONTAMINATION','BACKGROUND_ERROR','LIGHTING_ERROR','IMAGE_QUALITY','OTHER']);
const BODY_BUILD_FIELDS = Object.freeze(['apparentHeightRange','shoulderWidth','torsoProportions','bodyType','armProportions',
  'legProportions','posture','apparentFitnessBuild','handSizeRelationship','otherDescriptors']);
const L2_NEUTRAL_REFERENCE_OUTFIT = Object.freeze({ id:'L2_NEUTRAL_REFERENCE_OUTFIT', classification:'REFERENCE_PRESENTATION',
  identityAttribute:false, wardrobePack:false, top:'plain solid neutral fitted top', bottom:'plain solid neutral trousers',
  footwear:'plain neutral closed shoes where feet are visible', prohibited:Object.freeze(['logos','patterns','large accessories',
    'fashion statements','sexualized styling','identity-defining wardrobe']) });

function normalizedChoice(value, choices, code, label) {
  const normalized = String(value || '').toUpperCase();
  if (!choices.includes(normalized)) throw new AvatarStudioError(400,code,`${label} is invalid`);
  return normalized;
}
function unknown(value) { return value == null || String(value).trim() === '' ? 'UNKNOWN' : String(value).trim(); }

function canonicalBodyBuild(input = {}) {
  const descriptors = Object.fromEntries(BODY_BUILD_FIELDS.map((field) => [field, unknown(input[field])]));
  const forbidden = Object.keys(input).filter((key) => /medical|diagnos|ethnicity|religion|sexualOrientation|exactWeight|exactHeight/i.test(key));
  if (forbidden.length) throw new AvatarStudioError(400,'BODY_BUILD_SENSITIVE_INFERENCE_REJECTED',
    'Body Build may contain only non-sensitive visual continuity descriptors',{ forbidden });
  return Object.freeze({ schemaVersion:'avatar-body-build-v1', ...descriptors, unsupportedFieldsRemainUnknown:true });
}

function currentPassport(avatar = {}) {
  const events = avatar.passportCertificationEvents || [];
  return events.find((event) => (event.identityVersionId || event.identity_version_id) === (avatar.identityVersionId || avatar.identity_version_id)) || null;
}

function assertL1Context(avatar = {}) {
  const passport = currentPassport(avatar);
  if (!passport) throw new AvatarStudioError(409,'CERTIFIED_L1_PASSPORT_REQUIRED',
    'Body + Expressions Lab requires the current human-certified L1 Passport');
  const lock = (avatar.identityLocks || []).find((item) => (item.identityVersionId || item.identity_version_id) === avatar.identityVersionId);
  if (!lock) throw new AvatarStudioError(409,'CURRENT_IDENTITY_LOCK_REQUIRED','A current Identity Lock is required');
  return Object.freeze({ passport, identityLock:lock });
}

function certifiedTypes(items = [], key, avatar, passport, bodyBuild = null) {
  return new Set(items.filter((item) => (item.identityVersionId || item.identity_version_id) === avatar.identityVersionId
    && (item.passportCertificationEventId || item.passport_certification_event_id) === passport.id
    && (!bodyBuild || (item.bodyBuildVersionId || item.body_build_version_id) === bodyBuild.id))
    .map((item) => item[key] || item[key.replace(/[A-Z]/g,(c)=>`_${c.toLowerCase()}`)] || item.referenceType || item.reference_type));
}

function evaluateL2Readiness(avatar = {}) {
  const passport = currentPassport(avatar);
  const bodyBuild = (avatar.bodyBuildVersions || []).find((item) => (item.identityVersionId || item.identity_version_id) === avatar.identityVersionId
    && passport && (item.passportCertificationEventId || item.passport_certification_event_id) === passport.id) || null;
  const body = passport && bodyBuild ? certifiedTypes(avatar.bodyReferenceCertifications,'referenceType',avatar,passport,bodyBuild) : new Set();
  const expressions = passport && bodyBuild ? certifiedTypes(avatar.expressionCertifications,'expressionType',avatar,passport,bodyBuild) : new Set();
  const mouths = passport ? certifiedTypes(avatar.mouthCalibrationCertifications,'mouthState',avatar,passport) : new Set();
  const requirements = [
    ['CERTIFIED_L1_PASSPORT',Boolean(passport)],['BODY_BUILD_CURRENT',Boolean(bodyBuild)],
    ...BODY_REFERENCE_TYPES.map((type)=>[`BODY_${type}`,body.has(type)]),
    ...REQUIRED_EXPRESSIONS.map((type)=>[`EXPRESSION_${type}`,expressions.has(type)]),
  ].map(([code,met])=>Object.freeze({code,status:met?'COMPLETE':'MISSING'}));
  const completed = requirements.filter((item)=>item.status==='COMPLETE').map((item)=>item.code);
  const missing = requirements.filter((item)=>item.status==='MISSING').map((item)=>item.code);
  const matchingEvent = (avatar.l2PackCertificationEvents || []).find((event) => passport && bodyBuild
    && (event.identityVersionId || event.identity_version_id) === avatar.identityVersionId
    && (event.passportCertificationEventId || event.passport_certification_event_id) === passport.id
    && (event.bodyBuildVersionId || event.body_build_version_id) === bodyBuild.id) || null;
  return Object.freeze({ status:missing.length?'INCOMPLETE':matchingEvent?'CERTIFIED':'READY_FOR_FINAL_CERTIFICATION',
    passport,bodyBuild,requirements:Object.freeze(requirements),completed:Object.freeze(completed),missing:Object.freeze(missing),
    requiredComponentCount:BODY_REFERENCE_TYPES.length+REQUIRED_EXPRESSIONS.length,
    completedComponentCount:BODY_REFERENCE_TYPES.filter((x)=>body.has(x)).length+REQUIRED_EXPRESSIONS.filter((x)=>expressions.has(x)).length,
    optional:Object.freeze({ energeticPositive:expressions.has('ENERGETIC_POSITIVE'), mouthCalibration:{
      certifiedStates:Object.freeze([...mouths]),complete:REQUIRED_MOUTH_STATES.every((state)=>mouths.has(state)),requiredForL2:false,
      futureCapability:'TALKING_HEAD_ELIGIBILITY' }}), certificationEvent:matchingEvent });
}

function canonicalL2GenerationSpec({ kind,referenceType,avatar,bodyBuild,passport,identityLock,requestedCandidateCount=1,
  preferredProvider=null,preferredModel=null,originalGenerationSpecId=null,repairDelta=null,actor='local-operator' }={}) {
  const assetKind=normalizedChoice(kind,['BODY','EXPRESSION','MOUTH'],'L2_SPEC_KIND_INVALID','L2 spec kind');
  const choices=assetKind==='BODY'?BODY_REFERENCE_TYPES:assetKind==='EXPRESSION'?EXPRESSION_TYPES:MOUTH_STATES;
  const target=normalizedChoice(referenceType,choices,'L2_REFERENCE_TYPE_INVALID','Reference type');
  const count=Number(requestedCandidateCount);
  if(!Number.isInteger(count)||count<1||count>12) throw new AvatarStudioError(400,'L2_CANDIDATE_COUNT_INVALID','Candidate count must be 1 to 12');
  const capability=assetKind==='BODY'?'CHARACTER_BODY_REFERENCE':assetKind==='EXPRESSION'?'CHARACTER_EXPRESSION_REFERENCE':'MOUTH_SHAPE_REFERENCE';
  const framing=assetKind==='BODY'?{
    CHEST_UP_NEUTRAL:'CHEST_UP_HEAD_AND_SHOULDERS_VISIBLE',FULL_BODY_STANDING_NEUTRAL:'HEAD_TO_FEET_FULLY_VISIBLE',
    SEATED_NEUTRAL:'NATURAL_SEATED_TORSO_LEGS_HANDS_READABLE'}[target]:'HEAD_AND_SHOULDERS_FIXED_CAMERA';
  const outputSize=assetKind==='BODY'?'1024x1536':'1024x1024';
  const costPlan=preferredModel==='gpt-image-2'?estimateOpenAIImagePlan({model:preferredModel,size:outputSize,quality:'high',count,
    referenceImageCount:1}):Object.freeze({status:'UNKNOWN',knownTotalCost:null,knownSubtotalCost:0,
    unknownElements:Object.freeze(['PROVIDER_PRICE_PER_CALL','TOTAL_COST']),currency:'USD',inventedCosts:false,unknownIsZero:false});
  const canonical={schemaVersion:'avatar-l2-generation-spec-v1',workspaceId:avatar.workspaceId,brandId:passport.brandId,
    audienceVertical:avatar.vertical,avatarId:avatar.id,identityVersionId:avatar.identityVersionId,
    passportCertificationEventId:passport.id,passportArtifactId:passport.sourceArtifactId,
    passportArtifactVersion:passport.sourceArtifactVersion,identityLockVersionId:identityLock.id,
    identityConstraints:identityLock.permanentAttributes||identityLock.permanent||{},
    temporaryExclusions:identityLock.temporaryAttributes||identityLock.temporary||{},
    bodyBuildVersionId:bodyBuild.id,kind:assetKind,referenceType:target,bodyBuild:bodyBuild.profile||bodyBuild.bodyBuild||bodyBuild,
    framing,pose:target,expression:assetKind==='BODY'?'NEUTRAL':target,camera:'EYE_LEVEL_NATURAL_PERSPECTIVE',
    light:'SOFT_EVEN_NEUTRAL',background:'NEUTRAL_STUDIO',clothingPolicy:L2_NEUTRAL_REFERENCE_OUTFIT,
    negativeConstraints:Object.freeze(['identity drift','age drift','body build drift','beautification','idealization','sexualization',
      'logos','patterns','accessories','anatomy defects','distortion']),providerCapability:capability,promptVersion:'avatar-l2-reference-prompt-v1',
    specVersion:'avatar-l2-generation-spec-v1',preferredProvider,preferredModel,requestedCandidateCount:count,
    callsPerCandidate:1,totalPlannedCalls:count,costPlan,
    approvalState:'EXECUTION_APPROVAL_REQUIRED',executionAuthorized:false,originalGenerationSpecId,repairDelta:repairDelta||null,
    provenance:Object.freeze({source:'AVATAR_STUDIO_L2_PLAN_ONLY',actor,providerCallsExecuted:0})};
  return Object.freeze({...canonical,planFingerprint:fingerprint(canonical),paidProviderCalls:0,externalGenerationCalls:0});
}

module.exports={BODY_BUILD_FIELDS,BODY_REFERENCE_TYPES,EXPRESSION_TYPES,L2_NEUTRAL_REFERENCE_OUTFIT,L2_REJECTION_REASONS,
  MOUTH_STATES,REQUIRED_EXPRESSIONS,REQUIRED_MOUTH_STATES,assertL1Context,canonicalBodyBuild,canonicalL2GenerationSpec,
  currentPassport,evaluateL2Readiness,normalizedChoice};
