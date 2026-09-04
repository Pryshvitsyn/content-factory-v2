'use strict';

// A deliberately narrow bridge: one approved chest-up still → one silent motion pilot.
const { AvatarStudioError, fingerprint } = require('./domain');
const { estimateComponent } = require('../v2.9.2/pricing-registry');
const { createVideoAdapter } = require('../v2.8/provider-adapter-factory');
const crypto = require('node:crypto');

const ROUTE = Object.freeze({ provider:'replicate', model:'wan-video/wan-2.7-r2v', profile:'STANDARD', capability:'REFERENCE_TO_VIDEO',
  resolution:'720p', aspectRatio:'9:16', durationSeconds:5, shotType:'single', plannedCalls:1, audioRequested:false });
const NEGATIVE = Object.freeze(['different person','identity substitution','face morph','age change','gender presentation change','hairstyle change','wardrobe change','extra people','large head turn','hands entering frame','talking','lip sync','camera movement','zoom','scene change']);

function isMinor(avatar) { const identity=avatar.identity||avatar.identitySpec||{}; return identity.permanentAttributes?.subjectAgeClass==='MINOR' || /\bminor\b/i.test(String(identity.agePresentation||'')); }
function currentPassport(avatar) { return (avatar.passportCertificationEvents||[]).find((x)=>x.identityVersionId===avatar.identityVersionId)||null; }
function currentLock(avatar) { return (avatar.identityLocks||[]).find((x)=>x.identityVersionId===avatar.identityVersionId)||null; }
function validFaceConsent(avatar, brandId) {
  if (avatar.subjectType==='SYNTHETIC') return true;
  const event=(avatar.consentEvents||[]).find((x)=>x.modality==='FACE'&&x.status==='APPROVED'&&x.eventType==='GRANT');
  return Boolean(event && (!event.expiresAt || new Date(event.expiresAt)>new Date()) && (event.allowedBrandIds||[]).includes(brandId)
    && (event.allowedVerticals||[]).includes(avatar.vertical||avatar.verticalCode));
}
function motionPrompt(minor) { return ['One continuous chest-up technical motion test. The same person shown in the reference images remains clearly the same person throughout. Static camera. Natural blink, subtle breathing, tiny natural head movement, minimal expression change. Mouth remains naturally closed. No speech. No hands entering frame. No scene change.',minor?'Family-safe and age-appropriate. Preserve the subject\'s existing appearance and clothing. No adultization, endorsement or testimonial framing.':null].filter(Boolean).join('\n'); }
function costPlan() { const video=estimateComponent({provider:ROUTE.provider,model:ROUTE.model,component:'VIDEO',resolution:ROUTE.resolution,durationSeconds:ROUTE.durationSeconds,count:1}); return Object.freeze({status:video.status, currency:'USD', knownTotalCost:video.amountUsd, knownSubtotalCost:video.amountUsd||0, unknownElements:video.amountUsd==null?Object.freeze(['VIDEO_TOTAL_COST']):Object.freeze([]), components:Object.freeze([video]), unknownIsZero:false}); }
async function validateMotionPilotVideo({bytes,inspector}={}) { if(!Buffer.isBuffer(bytes)||!bytes.length) throw new AvatarStudioError(502,'MOTION_PILOT_VIDEO_MISSING','A real non-empty MP4 artifact is required'); if(!inspector?.inspect) throw new AvatarStudioError(503,'VIDEO_VALIDATOR_UNAVAILABLE','Local MP4 validation is not configured'); const media=await inspector.inspect({bytes,contentType:'video/mp4',kind:'video'}); const seconds=Number(media.durationMs)/1000; if(media.kind!=='video'||!media.width||!media.height||!Number.isFinite(seconds)||seconds<=0||seconds<5||seconds>8||Number(media.width)>=Number(media.height)) throw new AvatarStudioError(502,'MOTION_PILOT_VIDEO_INVALID','Output must be a playable vertical MP4 between 5 and 8 seconds'); return Object.freeze({status:'PASS',contentType:'video/mp4',width:media.width,height:media.height,durationMs:media.durationMs,placeholderAccepted:false}); }

class AvatarMotionPilotService {
  constructor({repository,providerCatalog,providerGateway=null,assetIntakeService=null,storage=null,mediaInspector=null,adapterFactory=createVideoAdapter,env=process.env,actor='local-operator'}={}) { if(!repository||!providerCatalog) throw new Error('AvatarMotionPilotService requires repository and providerCatalog'); Object.assign(this,{repository,providerCatalog,providerGateway,assetIntakeService,storage,mediaInspector,adapterFactory,env,actor}); }
  async context(scope={}) {
    for(const field of ['workspaceId','brandId','vertical','avatarId','identityVersionId']) if(!scope[field]) throw new AvatarStudioError(400,'MOTION_PILOT_SCOPE_REQUIRED',`Explicit ${field} is required`);
    const avatar=await this.repository.getCharacter({id:scope.avatarId,brandId:scope.brandId});
    if(!avatar||avatar.workspaceId!==scope.workspaceId||(avatar.vertical||avatar.verticalCode)!==scope.vertical||avatar.identityVersionId!==scope.identityVersionId) throw new AvatarStudioError(409,'MOTION_PILOT_SCOPE_MISMATCH','Avatar scope or identity version is stale');
    const passport=currentPassport(avatar); if(!passport) throw new AvatarStudioError(409,'CERTIFIED_L1_PASSPORT_REQUIRED','A current human-certified Passport is required');
    const identityLock=currentLock(avatar); if(!identityLock) throw new AvatarStudioError(409,'CURRENT_IDENTITY_LOCK_REQUIRED','A current Identity Lock is required');
    const certification=(avatar.bodyReferenceCertifications||[]).find((x)=>x.identityVersionId===avatar.identityVersionId&&x.passportCertificationEventId===passport.id&&x.referenceType==='CHEST_UP_NEUTRAL');
    if(!certification) throw new AvatarStudioError(409,'CERTIFIED_CHEST_UP_NEUTRAL_REQUIRED','An individually certified CHEST_UP_NEUTRAL reference is required; full L2 certification is not required');
    if(!validFaceConsent(avatar,scope.brandId)) throw new AvatarStudioError(409,'CONSENT_INVALIDATED','Current applicable FACE consent is missing, expired, or outside this brand/vertical scope');
    const candidate=(avatar.bodyReferenceCandidates||[]).find((x)=>x.id===certification.candidateId);
    if(!candidate) throw new AvatarStudioError(409,'CERTIFIED_CHEST_UP_NEUTRAL_MISSING','The certified CHEST_UP_NEUTRAL candidate is unavailable');
    const intake=await this.repository.intake({id:candidate.intakeAssetId,brandId:scope.brandId,avatarId:avatar.id});
    if(!intake||intake.effectiveGate0Status!=='PASS') throw new AvatarStudioError(409,'GATE0_INVALIDATED','The certified CHEST_UP_NEUTRAL intake must remain Gate 0 PASS');
    return Object.freeze({avatar,passport,identityLock,certification,candidate,intake});
  }
  selection() { try{return this.providerCatalog.resolveSelection(ROUTE);}catch(error){throw new AvatarStudioError(error.status||409,error.code||'MOTION_PILOT_PROVIDER_UNAVAILABLE',error.message,error.details);} }
  async identityReferenceBundle(c) {
    const bytes=await this.storage.get({key:c.intake.artifactStorageKey});
    const contentHash=crypto.createHash('sha256').update(bytes).digest('hex');
    if(!Buffer.isBuffer(bytes)||contentHash!==c.intake.contentHash) throw new AvatarStudioError(409,'IDENTITY_REFERENCE_HASH_MISMATCH','Certified CHEST_UP_NEUTRAL bytes changed');
    const references=Object.freeze([{index:0,role:'CERTIFIED_CHEST_UP_NEUTRAL',viewpoint:'CHEST_UP_NEUTRAL',intakeId:c.intake.id,artifactId:c.intake.artifactId,artifactVersion:c.intake.artifactVersion,contentHash,mimeType:c.intake.mimeType,byteSize:bytes.length,storageKey:c.intake.artifactStorageKey}]);
    return Object.freeze({references,bundleFingerprint:fingerprint(references.map(({storageKey,...evidence})=>evidence))});
  }
  async plan(scope={}) { const c=await this.context(scope); const selection=this.selection(); const identityReferenceBundle=await this.identityReferenceBundle(c); const canonical=Object.freeze({schemaVersion:'avatar-motion-pilot-plan-v2-r2v',workspaceId:scope.workspaceId,brandId:scope.brandId,vertical:scope.vertical,avatarId:scope.avatarId,identityVersionId:scope.identityVersionId,identityLockVersionId:c.identityLock.id,passportCertificationEventId:c.passport.id,passportArtifactId:c.passport.sourceArtifactId,certifiedChestUpCertificationId:c.certification.id,certifiedChestUpCandidateId:c.candidate.id,certifiedChestUpIntakeId:c.intake.id,certifiedChestUpArtifactId:c.intake.artifactId,certifiedChestUpArtifactVersion:c.intake.artifactVersion,referenceContentHash:c.intake.contentHash,identityReferenceBundle,route:ROUTE,adapterFamily:selection.adapterFamily,minor:isMinor(c.avatar),prompt:motionPrompt(isMinor(c.avatar)),negativeGuidance:NEGATIVE,costPlan:costPlan(),humanApprovalRequired:true,executionAuthorized:false,provenance:Object.freeze({source:'AVATAR_STUDIO_MOTION_PILOT_PLAN_ONLY',providerCallsExecuted:0,externalGenerationCalls:0})}); const plan=Object.freeze({...canonical,planFingerprint:fingerprint(canonical)}); const stored=await this.repository.storeMotionPilotPlan({avatar:c.avatar,plan,actor:this.actor}); return Object.freeze({...plan,id:stored.id,durable:true,paidProviderCalls:0,externalGenerationCalls:0}); }
  async preflight({maximumAllowedCost,...scope}={}) { const c=await this.context(scope); const plan=await this.repository.motionPilotPlan({avatarId:scope.avatarId,brandId:scope.brandId,identityVersionId:scope.identityVersionId}); if(!plan) throw new AvatarStudioError(404,'MOTION_PILOT_PLAN_NOT_FOUND','Create an immutable motion pilot plan first'); const budget=Number(maximumAllowedCost); if(!Number.isFinite(budget)||budget<0) throw new AvatarStudioError(400,'MAXIMUM_ALLOWED_COST_REQUIRED','Set an explicit non-negative maximum allowed cost'); if(plan.costPlan.knownTotalCost!=null&&plan.costPlan.knownTotalCost>budget) throw new AvatarStudioError(409,'BUDGET_EXCEEDED','Known motion pilot cost exceeds maximumAllowedCost'); const snapshot=Object.freeze({planId:plan.id,planFingerprint:plan.planFingerprint,referenceBundleFingerprint:plan.identityReferenceBundle?.bundleFingerprint,...ROUTE,maximumAllowedCost:budget,sourceAvatarId:c.avatar.id,certifiedPassportId:c.passport.id,certifiedChestUpIntakeId:c.intake.id,certifiedChestUpArtifactId:c.intake.artifactId,certifiedChestUpArtifactVersion:c.intake.artifactVersion,costPlan:plan.costPlan,providerCallsExecuted:0,paidCallsExecuted:0}); const execution=await this.repository.createMotionPilotExecution({plan,snapshot,preflightFingerprint:fingerprint(snapshot),actor:this.actor}); return Object.freeze({executionId:execution.id,...snapshot,status:'AWAITING_APPROVAL',humanApprovalRequired:true,providerCalls:0,externalGenerationCalls:0}); }
  async approve({executionId,explicitConfirmation=false,unknownCostAcknowledged=false,...scope}={}) { if(!explicitConfirmation) throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Explicit approval is required'); const execution=await this.repository.motionPilotExecution({id:executionId,...scope}); if(!execution) throw new AvatarStudioError(404,'MOTION_PILOT_EXECUTION_NOT_FOUND','Motion pilot execution was not found'); if(['UNKNOWN','PARTIAL'].includes(execution.costPlan?.status)&&!unknownCostAcknowledged) throw new AvatarStudioError(409,'UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED','Unknown cost must be explicitly acknowledged'); const approval=await this.repository.approveMotionPilotExecution({execution,actor:this.actor}); return Object.freeze({approval,status:'APPROVED',providerCalls:0,externalGenerationCalls:0}); }
  async canonicalRequest({c,plan}) { const bundle=await this.identityReferenceBundle(c); if(bundle.bundleFingerprint!==plan.identityReferenceBundle?.bundleFingerprint) throw new AvatarStudioError(409,'STALE_APPROVAL','Identity reference bundle changed; create a new plan and approval'); const referenceImages=[]; for(const reference of bundle.references) { const bytes=await this.storage.get({key:reference.storageKey}); if(crypto.createHash('sha256').update(bytes).digest('hex')!==reference.contentHash) throw new AvatarStudioError(409,'IDENTITY_REFERENCE_HASH_MISMATCH','Identity reference bytes changed'); referenceImages.push(`data:${reference.mimeType};base64,${bytes.toString('base64')}`); } const request={capability:'REFERENCE_TO_VIDEO',providerSelection:{provider:ROUTE.provider,model:ROUTE.model},providerPrompt:plan.prompt,negativePrompt:plan.negativeGuidance.join(', '),resolution:ROUTE.resolution,aspectRatio:ROUTE.aspectRatio,durationSeconds:ROUTE.durationSeconds,shotType:'single',references:{referenceImages,referenceVideos:[]},identityReferenceBundle:bundle}; return Object.freeze({request,evidence:bundle}); }
  async checkpointProviderOutput({attempt,result,provenance}) {
    const rawArtifact=await this.assetIntakeService.persistMotionPilotRawProviderOutput({bytes:result.output,provider:ROUTE.provider,model:ROUTE.model,attemptId:attempt.id});
    const recorded=await this.repository.recordMotionPilotProviderSuccess({attempt,result,rawArtifact,lineage:{...provenance,visualOnly:true,rawProviderOutput:true}});
    return Object.freeze({rawArtifact,attempt:recorded});
  }
  async reprocessPersistedProviderOutput({execution,attempt,c,plan,assurances,provenance}) {
    if(!attempt.rawArtifactStorageKey) throw new AvatarStudioError(409,'MOTION_PILOT_RAW_OUTPUT_NOT_FOUND','No durable raw provider output exists for this attempt');
    const bytes=await this.storage.get({key:attempt.rawArtifactStorageKey});
    if(!Buffer.isBuffer(bytes)||crypto.createHash('sha256').update(bytes).digest('hex')!==attempt.rawContentHash) throw new AvatarStudioError(409,'MOTION_PILOT_RAW_OUTPUT_HASH_MISMATCH','The durable raw provider output is unavailable or changed');
    const validation=await validateMotionPilotVideo({bytes,inspector:this.mediaInspector});
    const ingested=await this.assetIntakeService.ingestProviderVideoOutput({avatar:c.avatar,brandId:plan.brandId,bytes,filename:'motion-pilot-reprocessed.mp4',provider:ROUTE.provider,model:ROUTE.model,attemptId:attempt.id,providerRequestId:attempt.providerRequestId,consentVerified:assurances.requiredFaceConsent!=='INVALID',provenance:{...provenance,recovery:{recoveredFromPersistedProviderOutput:true,newPredictionCreated:false,originalAttemptStatus:attempt.status,originalFailureClassification:attempt.failureClassification}}});
    const persisted=await this.repository.createRecoveredMotionPilotResult({execution,attempt,ingested,result:{requestId:attempt.providerRequestId,actualKnownCost:attempt.actualKnownCost},validation,provenance,actor:this.actor});
    return Object.freeze({status:'RECOVERED',result:persisted,artifact:ingested.asset,rawArtifactId:attempt.rawArtifactId,validation,newPredictionsCreated:0,providerCalls:0,externalGenerationCalls:0});
  }
  async generate({executionId,...scope}={}) {
    if(this.env.LIVE_PAID_GENERATION!=='true') throw new AvatarStudioError(409,'MOTION_PILOT_LIVE_EXECUTION_DISABLED','Motion pilot provider execution is disabled by LIVE_PAID_GENERATION');
    if(!this.env.REPLICATE_API_TOKEN) throw new AvatarStudioError(409,'MOTION_PILOT_PROVIDER_CREDENTIAL_REQUIRED','REPLICATE_API_TOKEN is required');
    const execution=await this.repository.motionPilotExecution({id:executionId,...scope});
    if(!execution?.approval) throw new AvatarStudioError(409,'EXECUTION_APPROVAL_REQUIRED','An approved immutable execution is required');
    if((execution.attempts||[]).length) throw new AvatarStudioError(409,'EXECUTION_ALREADY_ATTEMPTED','No auto-retry; create a new plan');
    const c=await this.context(scope); const plan=await this.repository.motionPilotPlan({avatarId:scope.avatarId,brandId:scope.brandId,identityVersionId:scope.identityVersionId});
    if(!plan||plan.planFingerprint!==execution.preflightSnapshot?.planFingerprint||Number(execution.maximumAllowedCost)<Number(plan.costPlan.knownTotalCost||0)) throw new AvatarStudioError(409,'STALE_APPROVAL','Plan, budget, or dependencies changed; preflight and approval again');
    const prepared=await this.canonicalRequest({c,plan}); const attempt=await this.repository.createMotionPilotAttempt({execution,actor:this.actor});
    const lineage={provenanceClass:'DERIVED_PROVIDER_OUTPUT',executionLineage:{executionId:execution.id,attemptId:attempt.id,generationSpecId:plan.id,identityVersionId:c.avatar.identityVersionId,identityLockVersionId:c.identityLock.id,certifiedReferenceId:c.certification.id,sourceAssetIds:[c.candidate.id]},assurances:{originalSourceEligible:c.intake.effectiveGate0Status==='PASS',originalSourceGate0Status:c.intake.effectiveGate0Status,requiredFaceConsent:c.avatar.subjectType==='SYNTHETIC'?'NOT_REQUIRED':validFaceConsent(c.avatar,scope.brandId)?'VALID':'INVALID',identityVersionCurrent:c.avatar.identityVersionId===plan.identityVersionId,identityLockCurrent:c.identityLock.id===plan.identityLockVersionId,providerExecutionApproved:Boolean(execution.approval)},visualOnly:true,executionId:execution.id,motionPilotPlanId:plan.id,referenceGeometry:prepared.evidence,passportCertificationEventId:c.passport.id,certifiedChestUpCertificationId:c.certification.id,sourceArtifactId:c.intake.artifactId,sourceArtifactVersion:c.intake.artifactVersion,sourceContentHash:plan.referenceContentHash};
    try {
      const adapter=this.adapterFactory(this.selection(),{env:this.env});
      const result=await adapter.generate({capability:'REFERENCE_TO_VIDEO',canonicalRequest:prepared.request,idempotencyKey:attempt.idempotencyKey,onProviderRequest:async({requestId,status})=>this.repository.recordMotionPilotProviderRequest({attempt,requestId,status,actor:this.actor})});
      // This is the paid-output boundary. Nothing capable of rejecting the media runs before it.
      await this.checkpointProviderOutput({attempt,result,provenance:lineage});
      const validation=await validateMotionPilotVideo({bytes:result.output,inspector:this.mediaInspector});
      const ingested=await this.assetIntakeService.ingestProviderVideoOutput({avatar:c.avatar,brandId:scope.brandId,bytes:result.output,filename:'motion-pilot.mp4',provider:ROUTE.provider,model:ROUTE.model,attemptId:attempt.id,providerRequestId:result.requestId,consentVerified:lineage.assurances.requiredFaceConsent!=='INVALID',provenance:lineage});
      const recorded=await this.repository.completeMotionPilotAttempt({attempt,result,ingested,validation,actor:this.actor});
      return Object.freeze({executionId:execution.id,status:'SUCCEEDED',attempt:recorded,artifact:ingested.asset,validation,providerCalls:1,externalGenerationCalls:1});
    } catch(error) {
      const failed=await this.repository.failMotionPilotAttempt({attempt,error,actor:this.actor});
      error.details={...(error.details||{}),motionPilotAttempt:{id:attempt.id,executionId:execution.id,providerStatus:failed?.providerStatus||'unknown',rawOutputSaved:Boolean(failed?.rawArtifactId),failureClassification:error.code}};
      throw error;
    }
  }
  async recoverExisting({executionId,attemptId,...scope}={}) {
    const execution=await this.repository.motionPilotExecution({id:executionId,...scope}); const attempt=(execution?.attempts||[]).find((item)=>item.id===attemptId);
    if(!execution||!attempt||!execution.approval) throw new AvatarStudioError(404,'MOTION_PILOT_RECOVERY_NOT_FOUND','Approved execution and its attempt are required');
    const recoverableRoute=execution.provider==='replicate'&&((execution.model===ROUTE.model&&execution.capability===ROUTE.capability)||(execution.model==='alibaba/wan-3'&&execution.capability==='IMAGE_TO_VIDEO'));
    if(attempt.status!=='FAILED'||!attempt.providerRequestId||!recoverableRoute) throw new AvatarStudioError(409,'MOTION_PILOT_RECOVERY_INELIGIBLE','Only persisted failed supported Replicate motion-pilot requests can be recovered');
    const existing=await this.repository.motionPilotResult?.({attemptId}); if(existing)return Object.freeze({status:'RECOVERED',idempotent:true,result:existing,newPredictionsCreated:0});
    const c=await this.context(scope); const plan=await this.repository.motionPilotPlan({avatarId:scope.avatarId,brandId:scope.brandId,identityVersionId:scope.identityVersionId});
    const assurances={originalSourceEligible:c.intake.effectiveGate0Status==='PASS',originalSourceGate0Status:c.intake.effectiveGate0Status,requiredFaceConsent:c.avatar.subjectType==='SYNTHETIC'?'NOT_REQUIRED':validFaceConsent(c.avatar,scope.brandId)?'VALID':'INVALID',identityVersionCurrent:c.avatar.identityVersionId===plan.identityVersionId&&execution.identityVersionId===plan.identityVersionId,identityLockCurrent:c.identityLock.id===plan.identityLockVersionId,providerExecutionApproved:Boolean(execution.approval)};
    if(!assurances.originalSourceEligible||assurances.requiredFaceConsent==='INVALID'||!assurances.identityVersionCurrent||!assurances.identityLockCurrent||!assurances.providerExecutionApproved) throw new AvatarStudioError(409,'MOTION_PILOT_RECOVERY_STALE','Recovery source, consent, identity, lock, or approval is no longer valid');
    const provenance={provenanceClass:'DERIVED_PROVIDER_OUTPUT',visualOnly:true,executionLineage:{executionId,attemptId,generationSpecId:plan.id,identityVersionId:c.avatar.identityVersionId,identityLockVersionId:c.identityLock.id,certifiedReferenceId:c.certification.id,sourceAssetIds:[c.candidate.id]},assurances};
    // A local checkpoint has priority over any provider GET/poll/download.
    if(attempt.rawArtifactStorageKey) return this.reprocessPersistedProviderOutput({execution,attempt,c,plan,assurances,provenance});
    const adapter=this.adapterFactory(this.selection(),{env:this.env});
    const result=await adapter.recover({capability:'IMAGE_TO_VIDEO',model:ROUTE.model,requestId:attempt.providerRequestId});
    const checkpoint=await this.checkpointProviderOutput({attempt,result,provenance:{...provenance,recovery:{recoveredFromExistingPrediction:true,newPredictionCreated:false}}});
    return this.reprocessPersistedProviderOutput({execution,attempt:checkpoint.attempt,c,plan,assurances,provenance});
  }
  async recoverFromPersistedProviderOutput({executionId,attemptId,...scope}={}) {
    const execution=await this.repository.motionPilotExecution({id:executionId,...scope});
    const attempt=(execution?.attempts||[]).find((item)=>item.id===attemptId);
    if(!attempt?.rawArtifactStorageKey) throw new AvatarStudioError(409,'MOTION_PILOT_RAW_OUTPUT_NOT_FOUND','No durable raw provider output exists for this attempt');
    // recoverExisting has the complete immutable lineage/consent contract; the raw branch above is strictly local.
    return this.recoverExisting({executionId,attemptId,...scope});
  }
}
module.exports={AvatarMotionPilotService,NEGATIVE,ROUTE,motionPrompt,validateMotionPilotVideo};
