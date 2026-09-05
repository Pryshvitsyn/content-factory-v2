'use strict';

const crypto = require('node:crypto');
const {AvatarStudioError, fingerprint} = require('./domain');
const {avatarQaTaskProfile} = require('./avatar-qa-task-profile');
const {referenceClassification, poseState, DEFAULT_AVATAR_BODY_POSE_QA_POLICY} = require('./avatar-pose-qa-service');
const {FfmpegReferenceGeometryNormalizer} = require('../v2.10.2/reference-geometry');

const POLICY = Object.freeze({version:'provider-reference-canonical-v1', headroomFaceHeights:.4,
  headSideFaceWidths:.15, shoulderPaddingWidths:.15, chestBelowShoulderWidths:.55, personPadding:.03,
  tinyFrameArea:.001, tinyIntendedAreaRatio:.05, plausibleSecondaryArea:.003, associationConfidence:.5});
const CAPTURE = 'Take one chest-up photo with only you visible, including both shoulders.';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const finite = values => values.every(v => typeof v === 'number' && Number.isFinite(v));
const intersects = (a,b) => a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height;
const contains = (a,b) => a.x <= b.x && a.y <= b.y && a.x+a.width >= b.x+b.width && a.y+a.height >= b.y+b.height;
const boxOf = face => ({x:face.box[0],y:face.box[1],width:face.box[2],height:face.box[3]});
const faceIndex = face => face.faceIndex ?? face.index;
const personIndex = person => person.personIndex ?? person.index;
const areaRatio = face => face.areaRatio ?? face.frameAreaRatio;
function blocked(reason, evidence={}) {return {status:'BLOCKED',reasonCode:'PROVIDER_REFERENCE_SINGLE_SUBJECT_REQUIRED',detailCode:reason,instruction:CAPTURE,...evidence};}
function presentationPolicy(route) {
  const p=route?.providerReferencePresentation;
  if(!route?.id || !p || p.automaticSingleSubjectCanonicalization!==true || p.anisotropicStretchAllowed!==false ||
    !['PRESERVE_NATIVE','PAD_TO_ROUTE_ASPECT','CROP_TO_ROUTE_ASPECT','RESIZE_FIT'].includes(p.aspectBehavior))
    throw new AvatarStudioError(409,'PROVIDER_REFERENCE_ROUTE_POLICY_REQUIRED','An explicit non-stretching reference presentation policy is required');
  if(p.aspectBehavior!=='PRESERVE_NATIVE' && (!Number.isInteger(p.targetWidth)||!Number.isInteger(p.targetHeight)||p.targetWidth<64||p.targetHeight<64||p.targetWidth>4096||p.targetHeight>4096))
    throw new AvatarStudioError(409,'PROVIDER_REFERENCE_TARGET_REQUIRED','Route policy must specify bounded target dimensions');
  return p;
}
function isolateSubject(diagnosis, profile=avatarQaTaskProfile(), policy=POLICY) {
  if(!finite([diagnosis.width,diagnosis.height]) || diagnosis.width<=0 || diagnosis.height<=0 || !Array.isArray(diagnosis.faces)) return blocked('DIAGNOSIS_INVALID');
  const intended=diagnosis.faces.filter(f=>f.identity?.status==='PASS');
  if(!intended.length) return blocked('IDENTITY_UNRESOLVED');
  const associatedCandidates=intended.map(face=>({face,associations:(face.associations||[]).filter(a=>a.status==='ASSOCIATED'&&a.confidence>=policy.associationConfidence)}))
    .filter(item=>item.associations.length===1).sort((a,b)=>b.associations[0].confidence-a.associations[0].confidence||faceIndex(a.face)-faceIndex(b.face));
  if(!associatedCandidates.length) return blocked('FACE_BODY_ASSOCIATION_UNCERTAIN');
  if(associatedCandidates[1]&&associatedCandidates[0].associations[0].confidence-associatedCandidates[1].associations[0].confidence<.10)
    return blocked('MULTIPLE_ASSOCIATED_IDENTITY_CANDIDATES');
  const {face,associations:associated}=associatedCandidates[0];
  if(associated.length!==1) return blocked('FACE_BODY_ASSOCIATION_UNCERTAIN');
  const person=diagnosis.persons.find(p=>personIndex(p)===associated[0].personIndex);
  if(!person?.joints || !Array.isArray(person.personBox) || !finite(person.personBox)) return blocked('PERSON_ROI_UNUSABLE');
  for(const name of profile.requiredJoints) {
    const j=person.joints[name];
    if(!j || !finite([j.x,j.y,j.visibility,j.presence]) || j.visibility<.5 || j.presence<.5 || j.x<0 || j.x>1 || j.y<0 || j.y>1) return blocked('REQUIRED_BODY_REGION_MISSING');
  }
  if(profile.requiredBodyRegions.some(region=>!['HEAD','LEFT_SHOULDER','RIGHT_SHOULDER'].includes(region))) return blocked('TASK_REGION_POLICY_UNSUPPORTED');
  const {width:w,height:h}=diagnosis, fb=boxOf(face), left=person.joints.leftShoulder,right=person.joints.rightShoulder;
  const shoulderWidth=Math.hypot((left.x-right.x)*w,(left.y-right.y)*h);
  if(shoulderWidth<fb.width || !finite([fb.x,fb.y,fb.width,fb.height]) || fb.width<32 || fb.height<32) return blocked('BODY_GEOMETRY_UNUSABLE');
  const x1=Math.floor(Math.min(fb.x-fb.width*policy.headSideFaceWidths,Math.min(left.x,right.x)*w-shoulderWidth*policy.shoulderPaddingWidths));
  const x2=Math.ceil(Math.max(fb.x+fb.width*(1+policy.headSideFaceWidths),Math.max(left.x,right.x)*w+shoulderWidth*policy.shoulderPaddingWidths));
  const y1=Math.floor(fb.y-fb.height*policy.headroomFaceHeights);
  const y2=Math.ceil(Math.max(fb.y+fb.height,Math.max(left.y,right.y)*h+shoulderWidth*policy.chestBelowShoulderWidths));
  const adjustedX2=x2<=w+2?Math.min(x2,w):x2,adjustedY2=y2<=h+2?Math.min(y2,h):y2;
  const requiredExtent={x:x1,y:y1,width:adjustedX2-x1,height:adjustedY2-y1};
  if(!contains({x:0,y:0,width:w,height:h},requiredExtent)) return blocked('HEAD_SHOULDER_OR_CHEST_MARGIN_MISSING',{requiredExtent});
  const roi={x:Math.max(0,Math.floor(person.personBox[0]*w-policy.personPadding*w)),y:Math.max(0,Math.floor(person.personBox[1]*h-policy.personPadding*h))};
  const roiRight=Math.min(w,Math.ceil(person.personBox[2]*w+policy.personPadding*w)),roiBottom=Math.min(h,Math.ceil(person.personBox[3]*h+policy.personPadding*h));
  let crop={x:Math.min(roi.x,x1),y:Math.min(roi.y,y1),width:0,height:0};
  crop.width=Math.max(roiRight,x2)-crop.x;crop.height=Math.max(roiBottom,y2)-crop.y;
  const secondary=[];
  for(const other of diagnosis.faces.filter(f=>faceIndex(f)!==faceIndex(face))) {
    const noAssociation=!(other.associations||[]).some(a=>a.status==='ASSOCIATED');
    const ob=boxOf(other),outside=!intersects(roi.width?roi:{...roi,width:roiRight-roi.x,height:roiBottom-roi.y},ob);
    const spurious=areaRatio(other)<policy.tinyFrameArea && other.area/face.area<policy.tinyIntendedAreaRatio && other.identity?.status==='FAIL' && noAssociation && outside && other.stability?.matchedRuns===0 && other.stability?.totalRuns===2;
    const real=areaRatio(other)>=policy.plausibleSecondaryArea && (other.identity?.status==='PASS'||other.stability?.matchedRuns>=1);
    if(!spurious&&!real) return blocked('SECONDARY_FACE_UNCERTAIN',{selectedFaceIndex:faceIndex(face)});
    secondary.push({faceIndex:faceIndex(other),classification:spurious?'SPURIOUS_BY_COMBINED_EVIDENCE':'REAL_SECONDARY_FACE',evidence:{frameAreaRatio:areaRatio(other),relativeIntendedArea:other.area/face.area,identity:other.identity.status,noAssociation,outsidePersonRoi:outside,stability:other.stability||null}});
    if(intersects(requiredExtent,ob)) return blocked('SECONDARY_FACE_OVERLAPS_REQUIRED_BODY',{requiredExtent,secondary});
    if(intersects(crop,ob)) {
      const candidates=[{x:Math.ceil(ob.x+ob.width),y:crop.y,width:crop.x+crop.width-Math.ceil(ob.x+ob.width),height:crop.height},
        {...crop,width:Math.floor(ob.x)-crop.x},{x:crop.x,y:Math.ceil(ob.y+ob.height),width:crop.width,height:crop.y+crop.height-Math.ceil(ob.y+ob.height)},
        {...crop,height:Math.floor(ob.y)-crop.y}].filter(c=>c.width>0&&c.height>0&&contains(c,requiredExtent)&&!intersects(c,ob));
      candidates.sort((a,b)=>b.width*b.height-a.width*a.height||a.x-b.x||a.y-b.y);
      if(!candidates.length)return blocked('NO_SAFE_PERSON_CROP');crop=candidates[0];
    }
  }
  return {status:'PASS',selectedFaceIndex:faceIndex(face),selectedPersonIndex:personIndex(person),selectionEvidence:{associationConfidence:associated[0].confidence,identityStatus:face.identity.status,identityObservations:face.identity.observations,runnerUpAssociationConfidence:associatedCandidates[1]?.associations[0].confidence||null},person,requiredExtent,
    crop:secondary.length?crop:null,case:secondary.length?(secondary.every(s=>s.classification==='SPURIOUS_BY_COMBINED_EVIDENCE')?'A':'B'):'SINGLE_SUBJECT',secondary};
}
function planTransform({diagnosis,resolution,presentation}) {
  const input=resolution.crop||{x:0,y:0,width:diagnosis.width,height:diagnosis.height};
  let crop={...input};const mode=presentation.aspectBehavior;
  if(mode==='CROP_TO_ROUTE_ASPECT') {
    const ratio=presentation.targetWidth/presentation.targetHeight;
    if(crop.width/crop.height>ratio){const width=Math.floor(crop.height*ratio);crop.x+=Math.floor((crop.width-width)/2);crop.width=width;}
    else {const height=Math.floor(crop.width/ratio);crop.y+=Math.floor((crop.height-height)/2);crop.height=height;}
    if(!contains(crop,resolution.requiredExtent)) return blocked('ROUTE_CROP_REMOVES_REQUIRED_BODY');
  }
  let width=crop.width,height=crop.height,resize=null,padding=null;
  if(mode!=='PRESERVE_NATIVE') {
    const scale=Math.min(presentation.targetWidth/width,presentation.targetHeight/height);
    const rw=Math.max(1,Math.round(width*scale)),rh=Math.max(1,Math.round(height*scale));
    resize={width:rw,height:rh,scale,aspectPreserved:true};width=rw;height=rh;
    if(mode==='PAD_TO_ROUTE_ASPECT') {padding={left:Math.floor((presentation.targetWidth-rw)/2),top:Math.floor((presentation.targetHeight-rh)/2),right:Math.ceil((presentation.targetWidth-rw)/2),bottom:Math.ceil((presentation.targetHeight-rh)/2),color:'black'};width=presentation.targetWidth;height=presentation.targetHeight;}
  }
  const unchanged=crop.x===0&&crop.y===0&&crop.width===diagnosis.width&&crop.height===diagnosis.height&&!resize&&!padding;
  return {status:'PASS',operation:unchanged?'NONE':'PERSON_ROI_CROP_AND_ROUTE_PRESENTATION',crop,padding,resize,targetDimensions:{width,height},targetAspectBehavior:mode,anisotropicStretch:false};
}
class FfmpegProviderReferenceTransformer {
  constructor({normalizer=new FfmpegReferenceGeometryNormalizer()}={}){this.normalizer=normalizer;}
  async transform({bytes,contentType,transform}) {
    const c=transform.crop,filters=[`crop=${c.width}:${c.height}:${c.x}:${c.y}`];
    if(transform.resize)filters.push(`scale=${transform.resize.width}:${transform.resize.height}`);
    if(transform.padding)filters.push(`pad=${transform.targetDimensions.width}:${transform.targetDimensions.height}:${transform.padding.left}:${transform.padding.top}:color=black`);
    filters.push('setsar=1');
    const output=await this.normalizer.transformImage({bytes,contentType,filter:filters.join(','),prefix:'provider-reference'});
    const geometry=await this.normalizer.probe(output,'image/jpeg');
    if(geometry.width!==transform.targetDimensions.width||geometry.height!==transform.targetDimensions.height)throw new AvatarStudioError(409,'PROVIDER_REFERENCE_GEOMETRY_MISMATCH','Transformed dimensions differ from the reviewed policy');
    return {bytes:output,contentType:'image/jpeg',geometry};
  }
}
class AvatarProviderReferenceCanonicalizer {
  constructor({repository,storage,artifactService,identityQaService,poseQaService,transformer=new FfmpegProviderReferenceTransformer(),policy=POLICY,actor='local-provider-reference-qa'}={}) {
    Object.assign(this,{repository,storage,artifactService,identityQaService,poseQaService,transformer,policy,actor});
  }
  async validate({truthSet,bytes,profile,diagnosis=null}) {
    const d=diagnosis||await this.identityQaService.evaluator.diagnose({truthSet,image:bytes});
    const identity=await this.identityQaService.evaluateProviderInput({truthSet,referenceBytes:[bytes]});
    const skeleton=await this.poseQaService.inspect({image:bytes});
    const body=referenceClassification(skeleton,profile,DEFAULT_AVATAR_BODY_POSE_QA_POLICY),pose=poseState(skeleton);
    const checks={faceCount:d.faces.length===1?'PASS':'FAIL',identity:identity.status,faceBodyAssociation:skeleton.association==='ASSOCIATED'?'PASS':'UNCERTAIN',bodyReference:body.status==='BODY_REFERENCE_USABLE'?'PASS':'NOT_USABLE',pose:pose.status==='PASS'&&skeleton.status==='POSE_USABLE'?'PASS':'NOT_USABLE'};
    return {status:Object.values(checks).every(v=>v==='PASS')?'PASS':'BLOCKED',checks,diagnosis:d,identity,skeleton,body,pose};
  }
  async prepare({avatar,brandId,source,route,profile=avatarQaTaskProfile()}={}) {
    if(!avatar?.workspaceId||!avatar.id||!avatar.identityVersionId||!brandId||source?.brandId!==brandId||source.characterId!==avatar.id||source.workspaceId!==avatar.workspaceId)
      throw new AvatarStudioError(409,'PROVIDER_REFERENCE_SCOPE_MISMATCH','Source ownership and current avatar/brand scope must match');
    const presentation=presentationPolicy(route),bytes=await this.storage.get({key:source.artifactStorageKey});
    if(!Buffer.isBuffer(bytes)||sha(bytes)!==source.contentHash)throw new AvatarStudioError(409,'PROVIDER_REFERENCE_SOURCE_HASH_MISMATCH','Certified source bytes changed');
    const truthSet=await this.identityQaService.truthSet({avatar,brandId});
    const before=await this.identityQaService.evaluator.diagnose({truthSet,image:bytes});
    const resolution=isolateSubject(before,profile,this.policy);
    if(resolution.status!=='PASS')return {...resolution,before};
    const transform=planTransform({diagnosis:before,resolution,presentation});
    if(transform.status!=='PASS')return {...transform,before,subjectResolution:resolution};
    const transformed=transform.operation==='NONE'?{bytes,contentType:source.mimeType,geometry:transform.targetDimensions}:await this.transformer.transform({bytes,contentType:source.mimeType,transform});
    const after=await this.validate({truthSet,bytes:transformed.bytes,profile,diagnosis:transform.operation==='NONE'?before:null});
    if(after.status!=='PASS')return blocked('POST_TRANSFORM_QA_REJECTED',{before,after,transform,subjectResolution:resolution});
    if(transform.operation==='NONE')return {status:'PASS',sourceUsedDirectly:true,bytes,contentType:source.mimeType,contentHash:source.contentHash,artifactId:source.artifactId,artifactVersion:source.artifactVersion,storageKey:source.artifactStorageKey,before,after,transform};
    const canonicalHash=sha(transformed.bytes),canonical={workspaceId:avatar.workspaceId,avatarId:avatar.id,identityVersionId:avatar.identityVersionId,brandId,routeId:route.id,taskProfileId:profile.id,
      sourceIntakeId:source.id,sourceAssetId:source.artifactId,sourceArtifactVersion:source.artifactVersion,sourceContentHash:source.contentHash,canonicalContentHash:canonicalHash,
      transformPolicyVersion:this.policy.version,transform:{...transform,policy:this.policy,routePolicyVersion:fingerprint(route),taskProfileVersion:profile.version,truthSetFingerprint:truthSet.truthSetFingerprint,evaluatorVersion:this.identityQaService.evaluator.policy?.version},
      subjectResolution:resolution,before,after,mimeType:transformed.contentType,width:transformed.geometry.width,height:transformed.geometry.height};
    const canonicalFingerprint=fingerprint(canonical);
    const existing=await this.repository.providerReferenceCanonical({canonicalFingerprint,brandId,avatarId:avatar.id});
    if(existing){const stored=await this.storage.get({key:existing.canonicalArtifactStorageKey});if(sha(stored)!==canonicalHash||existing.canonicalContentHash!==canonicalHash)throw new AvatarStudioError(409,'PROVIDER_REFERENCE_CANONICAL_HASH_MISMATCH','Canonical provider-reference bytes changed');return {...existing,status:'PASS',bytes:stored,contentType:existing.mimeType,contentHash:canonicalHash,artifactId:existing.canonicalArtifactId,artifactVersion:existing.canonicalArtifactVersion,storageKey:existing.canonicalArtifactStorageKey,before,after};}
    const artifact=await this.artifactService.createVersion({artifactId:`avatar-provider-reference-${avatar.workspaceId}-${brandId}-${source.id}`,type:'binary',content:transformed.bytes,stageId:'AVATAR_PROVIDER_REFERENCE_CANONICAL',attemptId:canonicalFingerprint,idempotencyKey:canonicalFingerprint,provider:'local-canonicalizer',model:'deterministic-person-roi',validationStatus:'PROVIDER_REFERENCE_QA_PASS'});
    const stored=await this.repository.createProviderReferenceCanonical({canonical:{...canonical,canonicalFingerprint},artifact,actor:this.actor});
    return {...stored,status:'PASS',bytes:transformed.bytes,contentType:transformed.contentType,contentHash:canonicalHash,artifactId:artifact.artifactId,artifactVersion:artifact.version,storageKey:artifact.storageKey,before,after,transform:canonical.transform};
  }
}
module.exports={AvatarProviderReferenceCanonicalizer,FfmpegProviderReferenceTransformer,PROVIDER_REFERENCE_CANONICAL_POLICY:POLICY,CAPTURE,isolateSubject,planTransform,presentationPolicy,sha};
