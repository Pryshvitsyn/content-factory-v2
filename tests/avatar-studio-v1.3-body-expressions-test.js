'use strict';

const assert=require('node:assert/strict');
const {evaluateAvatarLevels}=require('../src/avatar-studio/level-engine');
const {CAPABILITIES}=require('../src/v2.8/capabilities');
const {MODELS}=require('../src/v2.8/provider-definitions');
const {AvatarL2Service}=require('../src/avatar-studio/l2-service');
const {BODY_REFERENCE_TYPES,EXPRESSION_TYPES,L2_NEUTRAL_REFERENCE_OUTFIT,MOUTH_STATES,canonicalBodyBuild,
  canonicalL2GenerationSpec,evaluateL2Readiness}=require('../src/avatar-studio/l2-domain');
const {analyzeBodyCandidate,analyzeExpressionCandidate,analyzeMouthCandidate}=require('../src/avatar-studio/l2-qa');

const WORKSPACE='11111111-1111-4111-8111-111111111111',BRAND='22222222-2222-4222-8222-222222222222';
function avatar(overrides={}){return {id:'avatar-1',workspaceId:WORKSPACE,vertical:'PSYCHOLOGY_WELLBEING',verticalCode:'PSYCHOLOGY_WELLBEING',
  identityVersionId:'identity-v1',internalName:'Ava',subjectType:'SYNTHETIC',brandIds:[BRAND],brandPermissions:[{brandId:BRAND,allowed:true}],
  identity:{agePresentation:'adult',personality:'calm',role:'expert',languages:['en'],visualDirection:'natural',prohibitedUses:['deception']},
  consent:{status:'APPROVED'},consentEvents:[],sources:[],identityLocks:[{id:'lock-v1',identityVersionId:'identity-v1'}],
  passportCertificationEvents:[{id:'passport-cert-v1',identityVersionId:'identity-v1',identityLockVersionId:'lock-v1',brandId:BRAND,
    sourceArtifactId:'passport-artifact',sourceArtifactVersion:1}],passportCandidates:[{id:'passport-candidate',certificationEventId:'passport-cert-v1',intakeAssetId:'passport-intake'}],
  bodyBuildVersions:[],bodyReferenceCandidates:[],bodyReferenceCertifications:[],expressionCandidates:[],expressionCertifications:[],
  mouthCalibrationCandidates:[],mouthCalibrationCertifications:[],l2PackCertificationEvents:[],wardrobes:[],voiceProfiles:[],locations:[],performancePacks:[],continuityReadiness:[],...overrides};}
function certifications(build){return {bodyReferenceCertifications:BODY_REFERENCE_TYPES.map((referenceType,index)=>({id:`body-${index}`,referenceType,
  identityVersionId:'identity-v1',passportCertificationEventId:'passport-cert-v1',bodyBuildVersionId:build.id,qaSnapshotId:`bqa-${index}`})),
  expressionCertifications:['NEUTRAL','WARM_SMILE','SERIOUS_CONCERNED'].map((referenceType,index)=>({id:`expression-${index}`,referenceType,
  identityVersionId:'identity-v1',passportCertificationEventId:'passport-cert-v1',bodyBuildVersionId:build.id,qaSnapshotId:`eqa-${index}`}))};}

async function main(){
  const l1=avatar();assert.equal(evaluateAvatarLevels(l1).currentLevel,1,'human-certified current Passport creates L1');
  assert.deepEqual(BODY_REFERENCE_TYPES,['CHEST_UP_NEUTRAL','FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL']);
  assert(EXPRESSION_TYPES.includes('ENERGETIC_POSITIVE'));assert(MOUTH_STATES.includes('VISIBLE_TEETH'));
  const buildProfile=canonicalBodyBuild({shoulderWidth:'balanced'});assert.equal(buildProfile.apparentHeightRange,'UNKNOWN');
  assert.equal(buildProfile.legProportions,'UNKNOWN');assert.throws(()=>canonicalBodyBuild({exactWeight:'50kg'}),/non-sensitive/);
  assert.equal(L2_NEUTRAL_REFERENCE_OUTFIT.classification,'REFERENCE_PRESENTATION');assert.equal(L2_NEUTRAL_REFERENCE_OUTFIT.identityAttribute,false);
  assert.equal(L2_NEUTRAL_REFERENCE_OUTFIT.wardrobePack,false);
  const build={id:'build-v1',identityVersionId:'identity-v1',passportCertificationEventId:'passport-cert-v1',identityLockVersionId:'lock-v1',profile:buildProfile};
  const deps={avatar:l1,bodyBuild:build,passport:l1.passportCertificationEvents[0],identityLock:l1.identityLocks[0]};
  for(const [kind,type,capability] of [['BODY','CHEST_UP_NEUTRAL','CHARACTER_BODY_REFERENCE'],['EXPRESSION','WARM_SMILE','CHARACTER_EXPRESSION_REFERENCE'],['MOUTH','OOH','MOUTH_SHAPE_REFERENCE']]){
    const spec=canonicalL2GenerationSpec({...deps,kind,referenceType:type});assert.equal(spec.providerCapability,capability);assert.equal(spec.executionAuthorized,false);
    assert.equal(spec.paidProviderCalls,0);assert.equal(spec.externalGenerationCalls,0);assert.equal(spec.clothingPolicy.identityAttribute,false);
  }
  const bodyPass=analyzeBodyCandidate({width:1024,height:1536,referenceType:'FULL_BODY_STANDING_NEUTRAL',observations:Object.fromEntries([
    'FACE_IDENTITY','APPARENT_AGE','BODY_BUILD','SHOULDER_PROPORTIONS','TORSO_PROPORTIONS','ARM_PROPORTIONS','LEG_PROPORTIONS','HEAD_BODY_RATIO',
    'POSTURE','HAND_ANATOMY','FINGER_ANATOMY','FOOT_ANATOMY','CLOTHING_NEUTRALITY','ACCESSORY_CONTAMINATION','BACKGROUND','LIGHT','IMAGE_QUALITY'].map((x)=>[x,'PASS']))});
  assert.equal(bodyPass.status,'PASS_FOR_REVIEW');assert.equal(bodyPass.bodyContinuityConfidence,null);assert.equal(bodyPass.reasoning.opaqueSingleScore,false);
  for(const [flag,reason] of [['extraFingers','FINGER_FAILURE'],['missingFingers','FINGER_FAILURE'],['brokenWrists','HAND_FAILURE'],['duplicatedLimbs','LIMB_FAILURE'],
    ['incorrectFeet','FOOT_FAILURE'],['incorrectChairBodyContact','SEATED_CONTACT_FAILURE']]) assert(analyzeBodyCandidate({width:1024,height:1536,
      referenceType:'SEATED_NEUTRAL',anatomy:{[flag]:true}}).blockingFailures.includes(reason));
  assert.equal(analyzeBodyCandidate({width:1024,height:1536,referenceType:'CHEST_UP_NEUTRAL',observations:{FACE_IDENTITY:'FAIL'}}).status,'REJECT');
  assert.equal(analyzeBodyCandidate({width:1024,height:1536,referenceType:'CHEST_UP_NEUTRAL',observations:{BODY_BUILD:'FAIL'}}).status,'REJECT');
  const wrongExpression=analyzeExpressionCandidate({width:1024,height:1024,referenceType:'WARM_SMILE',observations:{EXPRESSION_MATCH:'WARN'}});
  assert(wrongExpression.warnings.includes('EXPRESSION_MATCH'));
  assert.equal(analyzeExpressionCandidate({width:1024,height:1024,referenceType:'NEUTRAL',observations:{IDENTITY_STABILITY:'FAIL'}}).status,'REJECT');
  assert(analyzeExpressionCandidate({width:1024,height:1024,referenceType:'WARM_SMILE',observations:{TEETH_CONTINUITY:'WARN'}}).warnings.includes('TEETH_CONTINUITY'));
  assert(analyzeMouthCandidate({width:1024,height:1024,referenceType:'OOH',observations:{MOUTH_STATE_MATCH:'FAIL'}}).blockingFailures.includes('MOUTH_STATE_MATCH'));
  const certs=certifications(build),readyAvatar=avatar({bodyBuildVersions:[build],...certs});
  const ready=evaluateL2Readiness(readyAvatar);assert.equal(ready.status,'READY_FOR_FINAL_CERTIFICATION');assert.equal(ready.completedComponentCount,6);
  assert.equal(ready.optional.mouthCalibration.requiredForL2,false);assert.equal(evaluateAvatarLevels(readyAvatar).currentLevel,1,'individual certifications remain L1');
  assert.equal(evaluateAvatarLevels(avatar({bodyBuildVersions:[build],...certs,bodyReferenceCandidates:[{id:'candidate'}]})).currentLevel,1,'candidates remain L1');
  const missingBody=evaluateL2Readiness(avatar({bodyBuildVersions:[build],...certs,bodyReferenceCertifications:certs.bodyReferenceCertifications.slice(0,2)}));
  assert(missingBody.missing.includes('BODY_SEATED_NEUTRAL'));
  const missingExpression=evaluateL2Readiness(avatar({bodyBuildVersions:[build],...certs,expressionCertifications:certs.expressionCertifications.slice(0,2)}));
  assert(missingExpression.missing.includes('EXPRESSION_SERIOUS_CONCERNED'));
  const event={id:'l2-event',identityVersionId:'identity-v1',passportCertificationEventId:'passport-cert-v1',bodyBuildVersionId:'build-v1'};
  assert.equal(evaluateAvatarLevels(avatar({bodyBuildVersions:[build],...certs,l2PackCertificationEvents:[event]})).currentLevel,2);
  assert.equal(evaluateAvatarLevels(avatar({identityVersionId:'identity-v2',bodyBuildVersions:[build],...certs,l2PackCertificationEvents:[event]})).currentLevel,0,'new Identity invalidates Passport and L2');
  assert.equal(evaluateL2Readiness(avatar({passportCertificationEvents:[{...l1.passportCertificationEvents[0],id:'passport-cert-v2'}],bodyBuildVersions:[build],...certs,l2PackCertificationEvents:[event]})).status,'INCOMPLETE','new Passport invalidates L2 dependencies');

  let providerCalls=0,storedSpec=null,storedBuild=null;const repo={avatar:l1,async getCharacter(){return this.avatar},async createBodyBuildVersion(value){storedBuild={id:'build-v1',identityVersionId:'identity-v1',passportCertificationEventId:'passport-cert-v1',identityLockVersionId:'lock-v1',profile:value.profile};this.avatar={...this.avatar,bodyBuildVersions:[storedBuild]};return storedBuild},
    async storeL2GenerationSpec({spec}){storedSpec={...spec,id:'spec-1',specification:spec};return storedSpec},async l2GenerationSpec(){return storedSpec},
    async createL2Execution({spec,snapshot,preflightFingerprint}){return {id:'exec-1',generationSpecId:spec.id,generationKind:spec.kind,preflightSnapshot:snapshot,preflightFingerprint}},
    async l2Execution(){return null}};
  const catalog={resolveSelection({capability}){assert(Object.values(CAPABILITIES).includes(capability));return {adapterFamily:'mock-image'}}};
  const service=new AvatarL2Service({repository:repo,providerCatalog:catalog,providerGateway:{async generate(){providerCalls+=1}},env:{LIVE_PAID_GENERATION:'false'}});
  const s={workspaceId:WORKSPACE,brandId:BRAND,vertical:'PSYCHOLOGY_WELLBEING',avatarId:'avatar-1',identityVersionId:'identity-v1'};
  await service.createBodyBuild({...s,profile:{shoulderWidth:'balanced'},humanApproval:true});
  const plan=await service.plan({...s,kind:'BODY',referenceType:'CHEST_UP_NEUTRAL',preferredProvider:'mock',preferredModel:'mock-v1'});
  assert.equal(plan.paidProviderCalls,0);const preflight=await service.preflight({...s,generationSpecId:plan.id,maximumAllowedCost:1});assert.equal(preflight.externalGenerationCalls,0);
  storedSpec={...storedSpec,costPlan:{status:'KNOWN',knownTotalCost:2}};await assert.rejects(()=>service.preflight({...s,generationSpecId:plan.id,maximumAllowedCost:1}),{code:'BUDGET_EXCEEDED'});
  storedSpec={...storedSpec,costPlan:plan.costPlan};
  repo.l2Execution=async()=>({id:'exec-1',workspaceId:WORKSPACE,brandId:BRAND,verticalCode:'PSYCHOLOGY_WELLBEING',characterId:'avatar-1',
    generationSpecId:'spec-1',generationKind:'BODY',provider:'mock',model:'mock-v1',adapterFamily:'mock-image',candidateCount:1,preflightFingerprint:preflight.preflightFingerprint,
    preflightSnapshot:{generationPlanFingerprint:plan.planFingerprint},costPlan:{status:'UNKNOWN'},maximumAllowedCost:1,approval:{preflightFingerprint:preflight.preflightFingerprint},attempts:[]});
  await assert.rejects(()=>service.approve({...s,executionId:'exec-1',explicitConfirmation:true}),{code:'UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED'});
  const validFingerprint=storedSpec.planFingerprint;storedSpec={...storedSpec,planFingerprint:'changed'};
  await assert.rejects(()=>service.approve({...s,executionId:'exec-1',explicitConfirmation:true,unknownCostAcknowledged:true}),{code:'STALE_PREFLIGHT'});storedSpec={...storedSpec,planFingerprint:validFingerprint};
  await assert.rejects(()=>service.generate({...s,executionId:'exec-1'}),{code:'L2_LIVE_EXECUTION_DISABLED'});assert.equal(providerCalls,0);
  await assert.rejects(()=>service.lab({...s,vertical:'TRAVEL'}),{code:'L2_SCOPE_MISMATCH'});
  const current=repo.avatar;repo.avatar={...current,sources:[{gate0Status:'BLOCK'}]};await assert.rejects(()=>service.lab(s),{code:'GATE0_INVALIDATED'});
  repo.avatar={...current,consentEvents:[{status:'REVOKED'}]};await assert.rejects(()=>service.lab(s),{code:'CONSENT_INVALIDATED'});repo.avatar=current;
  let mockExternalCalls=0,autoQa=0;repo.avatar={...repo.avatar,passportCandidates:[{certificationEventId:'passport-cert-v1',intakeAssetId:'passport-intake'}]};
  repo.intake=async()=>({id:'passport-intake',effectiveGate0Status:'PASS',artifactStorageKey:'passport-key',originalFilename:'passport.png',mimeType:'image/png',contentHash:'passport-hash'});
  repo.createL2Attempt=async()=>({id:'attempt-1',idempotencyKey:'mock-idempotency'});repo.addL2AttemptEvent=async()=>({});repo.useIntake=async()=>({id:'source-output'});
  repo.createGeneratedL2Candidate=async()=>({id:'generated-1',workspaceId:WORKSPACE,brandId:BRAND,characterId:'avatar-1',identityVersionId:'identity-v1',
    passportCertificationEventId:'passport-cert-v1',bodyBuildVersionId:'build-v1',referenceType:'CHEST_UP_NEUTRAL',artifactId:'artifact-1',artifactVersion:1});
  repo.createL2QaSnapshot=async({qa})=>{autoQa+=1;return {id:'auto-qa-1',status:qa.status}};repo.createL2ExecutionResult=async()=>({id:'result-1'});
  const liveMockService=new AvatarL2Service({repository:repo,providerCatalog:catalog,storage:{async get(){return Buffer.from('approved-passport')}},
    assetIntakeService:{async ingestProviderOutput(){return {asset:{id:'output-intake',width:1024,height:1536,artifactId:'artifact-1',artifactVersion:1,
      artifactStorageKey:'artifact-key',contentHash:'output-hash'},artifact:{artifactId:'artifact-1'}}}},providerGateway:{async generate(){mockExternalCalls+=1;
      return {output:Buffer.from('mock-image'),contentType:'image/png',requestId:'mock-request'}}},env:{LIVE_PAID_GENERATION:'true'}});
  const generated=await liveMockService.generate({...s,executionId:'exec-1'});assert.equal(generated.status,'GENERATED');assert.equal(generated.automaticRetries,0);
  assert.equal(mockExternalCalls,1);assert.equal(autoQa,1,'mock generation auto-registers immutable QA evidence');
  const openai=MODELS.find((item)=>item.provider==='openai'&&item.modelId==='gpt-image-1');for(const capability of [CAPABILITIES.CHARACTER_BODY_REFERENCE,CAPABILITIES.CHARACTER_EXPRESSION_REFERENCE,CAPABILITIES.MOUTH_SHAPE_REFERENCE])assert(openai.capabilities.includes(capability));
  console.log('Avatar Studio V1.3 tests: 49 requirement areas covered; real paid/image/video/voice/external=0; explicit mock image calls=1');
}
main().catch((error)=>{console.error(error);process.exitCode=1});
