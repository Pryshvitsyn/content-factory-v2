'use strict';

const { validateAvatarL2Continuity } = require('../v2.10/continuity-contract');
const { validateAvatarL2ReferenceGeometry } = require('../v2.10.2/reference-geometry');

const BODY_QA_DIMENSIONS=Object.freeze(['FACE_IDENTITY','APPARENT_AGE','BODY_BUILD','SHOULDER_PROPORTIONS','TORSO_PROPORTIONS',
  'ARM_PROPORTIONS','LEG_PROPORTIONS','HEAD_BODY_RATIO','POSTURE','HAND_ANATOMY','FINGER_ANATOMY','FOOT_ANATOMY',
  'CLOTHING_NEUTRALITY','ACCESSORY_CONTAMINATION','BACKGROUND','LIGHT','IMAGE_QUALITY']);
const ANATOMY_FAILURES=Object.freeze({extraFingers:'FINGER_FAILURE',missingFingers:'FINGER_FAILURE',mergedFingers:'FINGER_FAILURE',
  brokenWrists:'HAND_FAILURE',duplicatedLimbs:'LIMB_FAILURE',missingLimbs:'LIMB_FAILURE',unnaturalElbows:'LIMB_FAILURE',
  twistedShoulders:'POSTURE_FAILURE',brokenKnees:'LIMB_FAILURE',incorrectFeet:'FOOT_FAILURE',floatingBody:'POSTURE_FAILURE',
  incorrectChairBodyContact:'SEATED_CONTACT_FAILURE',impossibleSeatedGeometry:'SEATED_CONTACT_FAILURE'});
const EXPRESSION_QA_DIMENSIONS=Object.freeze(['IDENTITY_STABILITY','EXPRESSION_MATCH','APPARENT_AGE','JAW_STABILITY','NOSE_STABILITY',
  'EYE_IDENTITY','TEETH_CONTINUITY','HAIR','SKIN','OVEREXPRESSION','FACE_DISTORTION','IMAGE_QUALITY']);
const MOUTH_QA_DIMENSIONS=Object.freeze(['IDENTITY_STABILITY','MOUTH_STATE_MATCH','LIP_GEOMETRY','JAW_STABILITY','TEETH_CONTINUITY',
  'FACE_DISTORTION','AGE','IMAGE_QUALITY']);

function statusFor(raw){if(typeof raw==='number')return raw>=.8?'PASS':raw>=.65?'WARN':'FAIL';const value=String(raw||'').toUpperCase();
  return ['PASS','WARN','FAIL'].includes(value)?value:'NOT_MEASURED';}
function analyze({family,dimensions,width,height,referenceType,observations={},anatomy={},evidence={}}){
  const geometry=validateAvatarL2ReferenceGeometry({width,height,referenceType});
  const continuity=validateAvatarL2Continuity({family,observations,evidence});
  const checks=dimensions.map((code)=>Object.freeze({code,status:statusFor(observations[code]),score:typeof observations[code]==='number'?observations[code]:null,
    evidence:evidence[code]||null}));
  const failures=checks.filter((item)=>item.status==='FAIL').map((item)=>item.code);
  if(family==='BODY') for(const [field,reason] of Object.entries(ANATOMY_FAILURES)) if(anatomy[field]===true) failures.push(reason);
  if(geometry.status==='FAIL') failures.push('REFERENCE_GEOMETRY_INVALID');
  const warnings=checks.filter((item)=>['WARN','NOT_MEASURED'].includes(item.status)).map((item)=>item.code);
  const uniqueFailures=[...new Set(failures)];
  return Object.freeze({family,status:uniqueFailures.length?'REJECT':warnings.length?'WARN':'PASS_FOR_REVIEW',dimensions,
    checks:Object.freeze(checks),warnings:Object.freeze(warnings),blockingFailures:Object.freeze(uniqueFailures),
    bodyContinuityConfidence:family==='BODY'?continuity.continuityConfidence:null,geometry,continuity,
    reasoning:Object.freeze({automatedCertification:false,humanCertificationRequired:true,opaqueSingleScore:false}),
    engine:'AVATAR_L2_QA',engineVersion:'avatar-l2-qa-v1'});
}
function analyzeBodyCandidate(input={}){return analyze({...input,family:'BODY',dimensions:BODY_QA_DIMENSIONS});}
function analyzeExpressionCandidate(input={}){return analyze({...input,family:'EXPRESSION',dimensions:EXPRESSION_QA_DIMENSIONS});}
function analyzeMouthCandidate(input={}){return analyze({...input,family:'MOUTH',dimensions:MOUTH_QA_DIMENSIONS});}
module.exports={ANATOMY_FAILURES,BODY_QA_DIMENSIONS,EXPRESSION_QA_DIMENSIONS,MOUTH_QA_DIMENSIONS,
  analyzeBodyCandidate,analyzeExpressionCandidate,analyzeMouthCandidate};
