'use strict';

// Task profiles are policy, rather than assumptions embedded in the pose
// runtime. The core pose/body services deliberately accept one of these
// objects so later standing, seated, or performance work can add a profile
// without changing their geometry contracts.
const MOTION_PILOT_CHEST_UP=Object.freeze({
  id:'MOTION_PILOT_CHEST_UP',
  version:'avatar-qa-task-profile-v1',
  requiredBodyRegions:Object.freeze(['HEAD','LEFT_SHOULDER','RIGHT_SHOULDER']),
  requiredJoints:Object.freeze(['nose','leftShoulder','rightShoulder']),
  optionalJoints:Object.freeze(['leftElbow','rightElbow','leftWrist','rightWrist']),
  minimumUsableBodyReferences:3,
  requiredDimensions:Object.freeze(['TECHNICAL','IDENTITY','FACE_GEOMETRY','BODY_GEOMETRY','COMPOSITION','POSE_MOTION_CONTINUITY']),
  sampling:Object.freeze({frameCount:5,frameRatios:Object.freeze([.02,.25,.50,.75,.96])}),
  bodyReferencePolicy:Object.freeze({coordinateSpace:'SCREEN_NORMALIZED',secondaryCertifiedChestUpRequiresIdentityQaPass:true,duplicateKey:'SOURCE_CONTENT_HASH'}),
  acceptance:Object.freeze({anyFail:'FAIL',anyUncertain:'UNCERTAIN',notAvailableCannotPass:true}),
});

const PROFILES=Object.freeze({[MOTION_PILOT_CHEST_UP.id]:MOTION_PILOT_CHEST_UP});
function avatarQaTaskProfile(id='MOTION_PILOT_CHEST_UP'){
  const profile=PROFILES[id];
  if(!profile){const error=new Error(`Avatar QA task profile ${id} is not configured`);error.code='AVATAR_QA_TASK_PROFILE_UNKNOWN';throw error;}
  return profile;
}
module.exports={AVATAR_QA_TASK_PROFILES:PROFILES,MOTION_PILOT_CHEST_UP,avatarQaTaskProfile};
