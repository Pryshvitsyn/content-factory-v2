'use strict';

const { CAPABILITIES } = require('../v2.8/capabilities');
const { canonicalCreativeBrief } = require('./creative-contract');

function validateContinuity(input, provider = {}) {
  const brief = canonicalCreativeBrief(input);
  const capabilities = new Set(provider.capabilities || []);
  const checks = [];
  for (let index = 0; index < brief.storyboard.length; index += 1) {
    const shot = brief.storyboard[index];
    const policy = shot.referencePolicy;
    if (policy === 'PREVIOUS_SHOT_FRAME') {
      if (index === 0) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'The first shot has no previous succeeded frame.' });
      else if (!capabilities.has(CAPABILITIES.IMAGE_TO_VIDEO) && !capabilities.has(CAPABILITIES.REFERENCE_TO_VIDEO)) {
        checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'Selected provider/model lacks required image/reference-to-video capability.' });
      } else checks.push({ shotId: shot.shotId, status: 'READY', policy });
    } else if (policy === 'UPLOADED_REFERENCE') {
      if (!shot.referenceMedia?.artifactId) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'An immutable uploaded reference artifact is required.' });
      else if (!capabilities.has(CAPABILITIES.IMAGE_TO_VIDEO) && !capabilities.has(CAPABILITIES.REFERENCE_TO_VIDEO)) checks.push({ shotId: shot.shotId, status: 'BLOCKED', reason: 'Selected provider/model lacks required image/reference-to-video capability.' });
      else checks.push({ shotId: shot.shotId, status: 'READY', policy, artifactId: shot.referenceMedia.artifactId });
    } else checks.push({ shotId: shot.shotId, status: 'READY', policy: 'NONE' });
  }
  return Object.freeze({ status: checks.some((check) => check.status === 'BLOCKED') ? 'BLOCKED' : 'READY', checks: Object.freeze(checks) });
}

function resolveReferenceEvidence({ brief: input, shotIndex, artifacts = [] } = {}) {
  const brief = canonicalCreativeBrief(input); const shot = brief.storyboard[shotIndex];
  if (!shot) throw Object.assign(new Error('Shot does not exist'), { code: 'SHOT_NOT_FOUND' });
  if (shot.referencePolicy === 'NONE') return null;
  if (shot.referencePolicy === 'PREVIOUS_SHOT_FRAME') {
    if (shotIndex === 0) throw Object.assign(new Error('The first shot has no previous frame'), { code: 'REFERENCE_EVIDENCE_MISSING' });
    const prior = brief.storyboard[shotIndex - 1];
    const artifact = artifacts.find((item) => item.shotId === prior.shotId && item.kind === 'FRAME'
      && item.status === 'SUCCEEDED' && item.immutable === true && item.contentHash && item.storageKey);
    if (!artifact) throw Object.assign(new Error('Persisted immutable frame from the previous succeeded shot is required'), { code: 'REFERENCE_EVIDENCE_MISSING' });
    return Object.freeze({ policy: shot.referencePolicy, artifactId: artifact.artifactId, version: artifact.version,
      storageKey: artifact.storageKey, contentHash: artifact.contentHash, previousShotId: prior.shotId });
  }
  const artifact = artifacts.find((item) => item.artifactId === shot.referenceMedia?.artifactId
    && item.source === 'OPERATOR_UPLOAD' && item.immutable === true && item.contentHash && item.storageKey);
  if (!artifact) throw Object.assign(new Error('Immutable operator-uploaded reference evidence is required'), { code: 'REFERENCE_EVIDENCE_MISSING' });
  return Object.freeze({ policy: shot.referencePolicy, artifactId: artifact.artifactId, version: artifact.version,
    storageKey: artifact.storageKey, contentHash: artifact.contentHash });
}

function validateAvatarContinuityReadiness(input = {}) {
  const required = Object.freeze([
    ['identity','AVATAR_IDENTITY_CONTINUITY'], ['wardrobe','AVATAR_WARDROBE_CONTINUITY'],
    ['props','AVATAR_PROP_CONTINUITY'], ['location','AVATAR_LOCATION_CONTINUITY'],
    ['geometry','AVATAR_GEOMETRY_CONTINUITY'], ['voice','AVATAR_VOICE_CONTINUITY'], ['lipSync','AVATAR_LIP_SYNC'],
  ]);
  const checks = required.map(([field, code]) => Object.freeze({ code,
    status: String(input[field]?.status || input[field] || '').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL' }));
  const shotContinuity = input.brief && input.provider ? validateContinuity(input.brief, input.provider) : null;
  if (shotContinuity?.status === 'BLOCKED') checks.push(Object.freeze({ code: 'EXISTING_SHOT_CONTINUITY', status: 'FAIL',
    reason: 'Existing V2.10 shot continuity contract is blocked.' }));
  return Object.freeze({ status: checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    checks: Object.freeze(checks), shotContinuity, engine: 'V2.10_CONTINUITY_CONTRACT' });
}

function validatePassportIdentityContinuity(input = {}) {
  const dimensions = Object.freeze([
    'SOURCE_SIMILARITY','FRONTAL_IDENTITY','THREE_QUARTER_IDENTITY','PROFILE_IDENTITY','CROSS_PANEL_IDENTITY',
    'APPARENT_AGE','HEAD_GEOMETRY','NOSE','JAW','CHIN','HAIRLINE','HAIR','FACIAL_HAIR','SKIN','DISTINCTIVE_FEATURES',
    'ACCESSORY_CONTAMINATION','WARDROBE_CONTAMINATION','BACKGROUND_COMPLIANCE','LIGHTING_COMPLIANCE','IMAGE_QUALITY',
  ]);
  const observations = input.observations || {};
  const driftCodes = [];
  if (input.profileDrift === true || observations.PROFILE_IDENTITY === 'FAIL') driftCodes.push('PROFILE_DRIFT');
  for (const [field, code] of [['noseChanged','NOSE_CHANGED'],['jawChanged','JAW_CHANGED'],['chinChanged','CHIN_CHANGED'],
    ['ageChanged','AGE_CHANGED'],['hairChanged','HAIR_CHANGED'],['hairlineChanged','HAIRLINE_CHANGED'],['faceChanged','FACE_CHANGED']]) {
    if (input[field] === true) driftCodes.push(code);
  }
  const checks = dimensions.map((code) => {
    const raw = observations[code];
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0,Math.min(1,raw)) : null;
    const status = numeric == null ? (String(raw || '').toUpperCase() === 'FAIL' ? 'FAIL'
      : String(raw || '').toUpperCase() === 'PASS' ? 'PASS' : 'NOT_MEASURED') : numeric >= 0.8 ? 'PASS' : numeric >= 0.65 ? 'WARN' : 'FAIL';
    return Object.freeze({ code, status, score: numeric,
      evidence: input.evidence?.[code] || (status === 'NOT_MEASURED' ? 'LOCAL_DETERMINISTIC_ANALYSIS_CANNOT_VERIFY_BIOMETRIC_IDENTITY' : null) });
  });
  const numeric = checks.map((item) => item.score).filter((score) => score != null);
  const samePersonConfidence = numeric.length ? Number((numeric.reduce((sum,value) => sum + value,0) / numeric.length).toFixed(4)) : null;
  const blockingFailures = [...new Set([...driftCodes, ...checks.filter((item) => item.status === 'FAIL').map((item) => item.code)])];
  const warnings = checks.filter((item) => ['WARN','NOT_MEASURED'].includes(item.status)).map((item) => item.code);
  return Object.freeze({ status: blockingFailures.length ? 'REJECT' : warnings.length ? 'WARN' : 'PASS_FOR_REVIEW',
    samePersonConfidence, dimensions, checks: Object.freeze(checks), warnings: Object.freeze(warnings),
    blockingFailures: Object.freeze(blockingFailures), engine: 'V2.10_CONTINUITY_CONTRACT',
    engineVersion: 'v2.10-avatar-passport-v1', profileScrutiny: Object.freeze({
      required: ['NOSE_SILHOUETTE','FOREHEAD','LIPS','CHIN','JAW_LINE','EAR_RELATIONSHIP','HAIRLINE','APPARENT_AGE'],
      outcome: driftCodes.length ? 'FAIL' : 'HUMAN_REVIEW_REQUIRED',
    }) });
}

function validateAvatarL2Continuity(input = {}) {
  const family = String(input.family || '').toUpperCase();
  const dimensions = family === 'BODY' ? ['FACE_IDENTITY','APPARENT_AGE','BODY_BUILD','SHOULDER_PROPORTIONS',
    'TORSO_PROPORTIONS','ARM_PROPORTIONS','LEG_PROPORTIONS','HEAD_BODY_RATIO','POSTURE']
    : family === 'EXPRESSION' ? ['IDENTITY_STABILITY','EXPRESSION_MATCH','APPARENT_AGE','JAW_STABILITY','NOSE_STABILITY',
      'EYE_IDENTITY','TEETH_CONTINUITY','HAIR','SKIN']
      : ['IDENTITY_STABILITY','MOUTH_STATE_MATCH','LIP_GEOMETRY','JAW_STABILITY','TEETH_CONTINUITY','AGE'];
  const observations=input.observations||{};
  const checks=dimensions.map((code)=>{const raw=observations[code];const score=typeof raw==='number'&&Number.isFinite(raw)
    ?Math.max(0,Math.min(1,raw)):null;const status=score!=null?(score>=0.8?'PASS':score>=0.65?'WARN':'FAIL')
      :String(raw||'').toUpperCase()==='FAIL'?'FAIL':String(raw||'').toUpperCase()==='PASS'?'PASS':'NOT_MEASURED';
    return Object.freeze({code,status,score,evidence:input.evidence?.[code]||null});});
  const scored=checks.filter((item)=>item.score!=null);const confidence=scored.length
    ?Number((scored.reduce((sum,item)=>sum+item.score,0)/scored.length).toFixed(4)):null;
  return Object.freeze({family,dimensions:Object.freeze(dimensions),checks:Object.freeze(checks),continuityConfidence:confidence,
    failures:Object.freeze(checks.filter((item)=>item.status==='FAIL').map((item)=>item.code)),
    warnings:Object.freeze(checks.filter((item)=>['WARN','NOT_MEASURED'].includes(item.status)).map((item)=>item.code)),
    engine:'V2.10_CONTINUITY_CONTRACT',engineVersion:'v2.10-avatar-l2-v1'});
}

module.exports = { resolveReferenceEvidence, validateAvatarContinuityReadiness, validateAvatarL2Continuity,
  validateContinuity, validatePassportIdentityContinuity };
