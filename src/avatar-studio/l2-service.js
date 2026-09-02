'use strict';

const { AvatarStudioError, fingerprint, stringList } = require('./domain');
const { analyzeBodyCandidate,analyzeExpressionCandidate,analyzeMouthCandidate } = require('./l2-qa');
const { L2_REJECTION_REASONS,assertL1Context,canonicalBodyBuild,canonicalL2GenerationSpec,evaluateL2Readiness,
  normalizedChoice } = require('./l2-domain');

const FAMILIES=Object.freeze({BODY:{role:'BODY_REFERENCE_CANDIDATE',candidateKey:'bodyReferenceCandidates'},
  EXPRESSION:{role:'EXPRESSION_REFERENCE_CANDIDATE',candidateKey:'expressionCandidates'},
  MOUTH:{role:'MOUTH_CALIBRATION_CANDIDATE',candidateKey:'mouthCalibrationCandidates'}});

class AvatarL2Service {
  constructor({repository,assetIntakeService=null,providerCatalog=null,providerGateway=null,storage=null,env=process.env,
    actor='local-operator'}={}) { if(!repository)throw new Error('AvatarL2Service requires repository');Object.assign(this,
      {repository,assetIntakeService,providerCatalog,providerGateway,storage,env,actor}); }

  async context(scope={}, {requireL1=true}={}) {
    for(const field of ['workspaceId','brandId','vertical','avatarId','identityVersionId']) if(!scope[field])
      throw new AvatarStudioError(400,'L2_SCOPE_REQUIRED',`Explicit ${field} is required for Body + Expressions Lab`);
    const avatar=await this.repository.getCharacter({id:scope.avatarId,brandId:scope.brandId});
    if(!avatar||avatar.workspaceId!==scope.workspaceId||avatar.vertical!==scope.vertical&&avatar.verticalCode!==scope.vertical
      ||avatar.identityVersionId!==scope.identityVersionId) throw new AvatarStudioError(409,'L2_SCOPE_MISMATCH',
        'Workspace, brand, vertical, avatar or Identity Version scope is stale');
    const dependencies=requireL1?assertL1Context(avatar):{};
    if(requireL1){
      const revoked=(avatar.consentEvents||[]).find((item)=>['REVOKED','EXPIRED'].includes(item.status));
      if(revoked)throw new AvatarStudioError(409,'CONSENT_INVALIDATED','Face consent was revoked or expired');
      const blocked=(avatar.sources||[]).find((item)=>(item.gate0Status||item.gate0_status)==='BLOCK');
      if(blocked)throw new AvatarStudioError(409,'GATE0_INVALIDATED','An authoritative avatar source is Gate 0 BLOCK');
    }
    return Object.freeze({avatar,...dependencies});
  }
  async lab(scope={}) { const {avatar}=await this.context(scope);return Object.freeze({...avatar,l2Readiness:evaluateL2Readiness(avatar)}); }

  async createBodyBuild({profile={},humanApproval=false,...scope}={}) {
    if(!humanApproval)throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Body Build requires explicit human approval');
    const {avatar,passport,identityLock}=await this.context(scope);const bodyBuild=canonicalBodyBuild(profile);
    const created=await this.repository.createBodyBuildVersion({avatar,brandId:scope.brandId,passport,identityLock,
      profile:bodyBuild,profileHash:fingerprint(bodyBuild),actor:this.actor});
    return Object.freeze({bodyBuild:created,l2Readiness:evaluateL2Readiness({...avatar,bodyBuildVersions:[created,...avatar.bodyBuildVersions||[]]}),
      paidProviderCalls:0,externalGenerationCalls:0});
  }

  async plan({kind,referenceType,requestedCandidateCount=1,preferredProvider=null,preferredModel=null,
    originalGenerationSpecId=null,repairDelta=null,...scope}={}) {
    const {avatar,passport,identityLock}=await this.context(scope);
    const bodyBuild=(avatar.bodyBuildVersions||[]).find((item)=>item.identityVersionId===avatar.identityVersionId
      && item.passportCertificationEventId===passport.id);
    if(!bodyBuild)throw new AvatarStudioError(409,'CURRENT_BODY_BUILD_REQUIRED','Approve a Body Build profile for the current Passport first');
    const capability=String(kind||'').toUpperCase()==='BODY'?'CHARACTER_BODY_REFERENCE':String(kind||'').toUpperCase()==='EXPRESSION'
      ?'CHARACTER_EXPRESSION_REFERENCE':'MOUTH_SHAPE_REFERENCE';
    if(!preferredProvider&&!preferredModel){const current=this.providerCatalog.preferredModel?.({provider:'openai',capability,profile:'PREMIUM'});
      if(current){preferredProvider=current.provider;preferredModel=current.modelId;}}
    const spec=canonicalL2GenerationSpec({kind,referenceType,avatar,bodyBuild,passport,identityLock,requestedCandidateCount,
      preferredProvider,preferredModel,originalGenerationSpecId,repairDelta,actor:this.actor});
    if(preferredProvider||preferredModel){if(!preferredProvider||!preferredModel)throw new AvatarStudioError(400,'L2_PROVIDER_SELECTION_INCOMPLETE',
      'Provider and model must be selected together');try{this.providerCatalog.resolveSelection({provider:preferredProvider,model:preferredModel,
        profile:'PREMIUM',capability:spec.providerCapability});}catch(error){throw new AvatarStudioError(error.status||409,error.code||'L2_CAPABILITY_UNSUPPORTED',error.message,error.details);}}
    const stored=await this.repository.storeL2GenerationSpec({avatar,spec,actor:this.actor});
    return Object.freeze({...spec,id:stored.id,durable:true});
  }

  async uploadCandidate({kind,generationSpecId,intakeId,repairParentCandidateId=null,...scope}={}) {
    const family=normalizedChoice(kind,Object.keys(FAMILIES),'L2_SPEC_KIND_INVALID','L2 candidate kind');
    const {avatar}=await this.context(scope);const spec=await this.repository.l2GenerationSpec({id:generationSpecId,kind:family,...scope});
    if(!spec)throw new AvatarStudioError(404,'L2_GENERATION_SPEC_NOT_FOUND','L2 Generation Spec was not found in this scope');
    const intake=await this.repository.intake({id:intakeId,brandId:scope.brandId,avatarId:avatar.id});
    if(!intake||intake.effectiveGate0Status!=='PASS'||!String(intake.mimeType||'').startsWith('image/'))throw new AvatarStudioError(409,
      'L2_CANDIDATE_INTAKE_INELIGIBLE','Manual L2 candidate must be an image that passes Gate 0');
    const source=await this.repository.sourceForIntake({intakeId,avatarId:avatar.id,brandId:scope.brandId});
    if(!source||!(source.roles||[]).includes(FAMILIES[family].role))throw new AvatarStudioError(409,'L2_CANDIDATE_ROLE_REQUIRED',
      `Assign the explicit ${FAMILIES[family].role} source role before registration`);
    const candidate=await this.repository.createL2Candidate({family,avatar,spec,intake,source,repairParentCandidateId,actor:this.actor});
    return Object.freeze({candidate,paidProviderCalls:0,externalGenerationCalls:0});
  }

  async qa({kind,candidateId,observations={},anatomy={},evidence={},...scope}={}) {
    const family=normalizedChoice(kind,Object.keys(FAMILIES),'L2_SPEC_KIND_INVALID','L2 QA kind');const {avatar}=await this.context(scope);
    const candidate=await this.repository.l2Candidate({id:candidateId,family,...scope});
    if(!candidate)throw new AvatarStudioError(404,'L2_CANDIDATE_NOT_FOUND','L2 candidate was not found in this scope');
    const analyzer=family==='BODY'?analyzeBodyCandidate:family==='EXPRESSION'?analyzeExpressionCandidate:analyzeMouthCandidate;
    const analysis=analyzer({width:candidate.width,height:candidate.height,referenceType:candidate.referenceType,observations,anatomy,evidence});
    const snapshot=await this.repository.createL2QaSnapshot({family,candidate,qa:analysis,sourceEvidence:{artifactId:candidate.artifactId,
      artifactVersion:candidate.artifactVersion,identityVersionId:avatar.identityVersionId,passportCertificationEventId:candidate.passportCertificationEventId,
      referenceGeometryContract:'V2.10.2_REFERENCE_GEOMETRY',continuityContract:'V2.10_CONTINUITY_CONTRACT'},actor:this.actor});
    return Object.freeze({qaSnapshot:snapshot,analysis,automatedCertification:false,paidProviderCalls:0,externalGenerationCalls:0});
  }

  async review({kind,candidateId,action,rejectionReason=null,humanNote=null,guidedReview={},humanApproval=false,...scope}={}) {
    if(!humanApproval)throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','L2 candidate review requires an explicit human decision');
    const family=normalizedChoice(kind,Object.keys(FAMILIES),'L2_SPEC_KIND_INVALID','L2 review kind');const normalized=String(action||'').toUpperCase();
    if(!['KEEP','REJECT','COMPARE','SUPERSEDE'].includes(normalized))throw new AvatarStudioError(400,'L2_REVIEW_ACTION_INVALID','Unsupported review action');
    const reason=String(rejectionReason||'').toUpperCase();if(normalized==='REJECT'&&!L2_REJECTION_REASONS.includes(reason))
      throw new AvatarStudioError(400,'L2_REJECTION_REASON_REQUIRED','Choose a structured L2 rejection reason');
    await this.context(scope);const candidate=await this.repository.l2Candidate({id:candidateId,family,...scope});
    if(!candidate)throw new AvatarStudioError(404,'L2_CANDIDATE_NOT_FOUND','L2 candidate was not found in this scope');
    const qa=await this.repository.latestL2Qa({family,candidateId});const event=await this.repository.addL2ReviewEvent({family,candidate,
      qaSnapshotId:qa?.id,action:normalized,rejectionReason:normalized==='REJECT'?reason:null,humanNote,guidedReview,actor:this.actor});
    return Object.freeze({reviewEvent:event,levelUnchanged:true});
  }

  async certifyReference({kind,candidateId,guidedReview={},warningsAcknowledged=[],explicitConfirmation=false,humanApproval=false,...scope}={}) {
    if(!humanApproval||!explicitConfirmation)throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Reference certification requires explicit human confirmation');
    const family=normalizedChoice(kind,Object.keys(FAMILIES),'L2_SPEC_KIND_INVALID','L2 certification kind');const {avatar,passport}=await this.context(scope);
    const candidate=await this.repository.l2Candidate({id:candidateId,family,...scope});if(!candidate)throw new AvatarStudioError(404,'L2_CANDIDATE_NOT_FOUND','Candidate not found');
    if(candidate.identityVersionId!==avatar.identityVersionId||candidate.passportCertificationEventId!==passport.id)
      throw new AvatarStudioError(409,'L2_CANDIDATE_DEPENDENCY_STALE','Candidate does not depend on the current Identity and Passport');
    const required=family==='BODY'?['passport','bodyBuild','anatomy','posture','temporaryOutfit']
      :family==='EXPRESSION'?['passport','targetMatch','identityStable','facialStructure','teeth']
      :['passport','mouthState','identityStable','geometry'];
    if(!required.every((key)=>guidedReview[key]===true))throw new AvatarStudioError(409,'GUIDED_L2_REVIEW_REQUIRED',
      'Complete every guided comparison step; uncertainty must reject',{required});
    const qa=await this.repository.latestL2Qa({family,candidateId});if(!qa||qa.status==='REJECT')throw new AvatarStudioError(409,'L2_QA_NOT_READY','A non-rejected immutable QA snapshot is required');
    const review=await this.repository.latestL2Review?.({family,candidateId});if(review?.action==='REJECT')
      throw new AvatarStudioError(409,'L2_CANDIDATE_HUMAN_REJECTED','A human-rejected candidate cannot be certified');
    const event=await this.repository.certifyL2Reference({family,candidate,qa,guidedReview,warningsAcknowledged:stringList('warningsAcknowledged',warningsAcknowledged),actor:this.actor});
    return Object.freeze({certificationEvent:event,levelUnchanged:true,paidProviderCalls:0,externalGenerationCalls:0});
  }

  async readiness(scope={}) { const {avatar}=await this.context(scope);return evaluateL2Readiness(avatar); }
  async certifyPack({warningsAcknowledged=[],explicitConfirmation=false,humanApproval=false,...scope}={}) {
    if(!humanApproval||!explicitConfirmation)throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Final L2 Pack certification requires explicit human confirmation');
    const {avatar,passport}=await this.context(scope);const readiness=evaluateL2Readiness(avatar);
    if(readiness.certificationEvent)throw new AvatarStudioError(409,'L2_PACK_ALREADY_CERTIFIED','The current dependency set already has an immutable L2 certification');
    if(readiness.status!=='READY_FOR_FINAL_CERTIFICATION')throw new AvatarStudioError(409,'L2_PACK_INCOMPLETE','All required body and expression references must be certified',readiness);
    const event=await this.repository.certifyL2Pack({avatar,brandId:scope.brandId,passport,bodyBuild:readiness.bodyBuild,
      bodyCertifications:avatar.bodyReferenceCertifications,expressionCertifications:avatar.expressionCertifications,
      warningsAcknowledged:stringList('warningsAcknowledged',warningsAcknowledged),actor:this.actor});
    return Object.freeze({certificationEvent:event,readiness:Object.freeze({...readiness,status:'CERTIFIED',certificationEvent:event})});
  }

  async preflight({generationSpecId,maximumAllowedCost,...scope}={}) {
    const {avatar,passport}=await this.context(scope);const spec=await this.repository.l2GenerationSpec({id:generationSpecId,kind:null,...scope});
    if(!spec)throw new AvatarStudioError(404,'L2_GENERATION_SPEC_NOT_FOUND','L2 Generation Spec not found');
    if(spec.identityVersionId!==avatar.identityVersionId||spec.passportCertificationEventId!==passport.id)throw new AvatarStudioError(409,'STALE_PREFLIGHT','L2 dependencies changed');
    const budget=Number(maximumAllowedCost);if(!Number.isFinite(budget)||budget<0)throw new AvatarStudioError(400,'MAXIMUM_ALLOWED_COST_REQUIRED','Set a non-negative budget ceiling');
    const knownTotal=spec.costPlan?.knownTotalCost==null?null:Number(spec.costPlan.knownTotalCost);
    const knownSubtotal=Number(spec.costPlan?.knownSubtotalCost||0);
    const estimatedOutputCost=Number(spec.costPlan?.estimatedOutputCost||0);
    if(knownTotal!=null&&Number.isFinite(knownTotal)&&knownTotal>budget)throw new AvatarStudioError(409,'BUDGET_EXCEEDED',
      'Known L2 generation cost exceeds the maximum allowed cost',{knownTotalCost:knownTotal,maximumAllowedCost:budget});
    if(knownSubtotal>budget)throw new AvatarStudioError(409,'BUDGET_EXCEEDED','Known L2 output-cost subtotal exceeds the maximum allowed cost',
      {knownSubtotalCost:knownSubtotal,maximumAllowedCost:budget});
    if(estimatedOutputCost>budget)throw new AvatarStudioError(409,'BUDGET_EXCEEDED','Estimated L2 output cost exceeds the maximum allowed cost',
      {estimatedOutputCost,maximumAllowedCost:budget});
    const selection=this.providerCatalog.resolveSelection({provider:spec.preferredProvider,model:spec.preferredModel,profile:'PREMIUM',capability:spec.providerCapability});
    const snapshot={schemaVersion:'avatar-l2-execution-preflight-v1',workspaceId:scope.workspaceId,brandId:scope.brandId,vertical:scope.vertical,
      avatarId:scope.avatarId,identityVersionId:scope.identityVersionId,passportCertificationEventId:passport.id,generationSpecId:spec.id,
      generationPlanFingerprint:spec.planFingerprint,provider:spec.preferredProvider,model:spec.preferredModel,adapterFamily:selection.adapterFamily,
      capability:spec.providerCapability,candidateCount:spec.requestedCandidateCount,callsPerCandidate:1,totalPlannedCalls:spec.requestedCandidateCount,
      costPlan:{...spec.costPlan,maximumAllowedCost:budget,unknownIsZero:false},maximumAllowedCost:budget,promptVersion:spec.promptVersion,specVersion:spec.specVersion};
    const execution=await this.repository.createL2Execution({spec,snapshot,preflightFingerprint:fingerprint(snapshot),actor:this.actor});
    return Object.freeze({executionId:execution.id,...snapshot,preflightFingerprint:fingerprint(snapshot),status:'AWAITING_APPROVAL',providerCalls:0,externalGenerationCalls:0});
  }
  async approve({executionId,explicitConfirmation=false,unknownCostAcknowledged=false,...scope}={}) {
    if(!explicitConfirmation)throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Explicit approval is required');const execution=await this.repository.l2Execution({id:executionId,...scope});
    if(!execution)throw new AvatarStudioError(404,'L2_EXECUTION_NOT_FOUND','Execution not found');
    const spec=await this.repository.l2GenerationSpec({id:execution.generationSpecId,kind:execution.generationKind,...scope});
    if(!spec||spec.planFingerprint!==execution.preflightSnapshot?.generationPlanFingerprint)
      throw new AvatarStudioError(409,'STALE_PREFLIGHT','Generation Spec or dependencies changed; create a fresh preflight');
    if(['UNKNOWN','PARTIAL'].includes(execution.costPlan?.status)&&!unknownCostAcknowledged)
      throw new AvatarStudioError(409,'UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED','UNKNOWN or PARTIAL cost must be acknowledged');
    const approval=await this.repository.approveL2Execution({execution,unknownCostAcknowledged,actor:this.actor});return Object.freeze({approval,status:'APPROVED',providerCalls:0,externalGenerationCalls:0});
  }
  async generate({executionId,...scope}={}) {
    if(this.env.LIVE_PAID_GENERATION!=='true')throw new AvatarStudioError(409,'L2_LIVE_EXECUTION_DISABLED','L2 provider execution is disabled by LIVE_PAID_GENERATION');
    const execution=await this.repository.l2Execution({id:executionId,...scope});if(!execution?.approval)throw new AvatarStudioError(409,'EXECUTION_APPROVAL_REQUIRED','Approved execution required');
    if((execution.attempts||[]).length)throw new AvatarStudioError(409,'EXECUTION_ALREADY_ATTEMPTED','No automatic retry; create and approve a repair plan');
    const {avatar,passport,identityLock}=await this.context(scope);const spec=await this.repository.l2GenerationSpec({id:execution.generationSpecId,kind:execution.generationKind,...scope});
    if(!spec||spec.planFingerprint!==execution.preflightSnapshot?.generationPlanFingerprint||execution.approval.preflightFingerprint!==execution.preflightFingerprint)
      throw new AvatarStudioError(409,'STALE_APPROVAL','Approval no longer matches the current immutable plan');
    const passportCandidate=(avatar.passportCandidates||[]).find((item)=>item.certificationEventId===passport.id);
    if(!passportCandidate)throw new AvatarStudioError(409,'CERTIFIED_PASSPORT_ARTIFACT_REQUIRED','Current certified Passport artifact is unavailable');
    const intake=await this.repository.intake({id:passportCandidate.intakeAssetId,brandId:scope.brandId,avatarId:avatar.id});
    if(!intake||intake.effectiveGate0Status!=='PASS')throw new AvatarStudioError(409,'GATE0_INVALIDATED','Certified Passport is no longer Gate 0 eligible');
    const sourceImage={bytes:await this.storage.get({key:intake.artifactStorageKey}),filename:intake.originalFilename,contentType:intake.mimeType};
    const successes=[],failures=[];
    for(let ordinal=1;ordinal<=execution.candidateCount;ordinal+=1){
      const specification=spec.specification||spec;
      const outputSize=execution.generationKind==='BODY'?'1024x1536':'1024x1024';
      const request={capability:String(spec.providerCapability).toLowerCase().replaceAll('_','-'),candidateOrdinal:ordinal,
        prompt:JSON.stringify({description:'Canonical Avatar Studio L2 character reference',generation_requirements:{reference_type:spec.referenceType,
          body_build:specification.bodyBuild,framing:specification.framing,pose:specification.pose,
          expression:specification.expression,identity_lock_version_id:spec.identityLockVersionId,
          identity_constraints:specification.identityConstraints,temporary_elements_to_exclude:specification.temporaryExclusions,
          clothing_policy:specification.clothingPolicy,negative_prompt:(specification.negativeConstraints||[]).join(', '),
          size:outputSize,quality:'high'}}),referenceImages:[sourceImage]};
      const attempt=await this.repository.createL2Attempt({execution,ordinal,requestFingerprint:fingerprint({...request,referenceImages:[{contentHash:intake.contentHash}]}),actor:this.actor});
      try{const result=await this.providerGateway.generate({provider:execution.adapterFamily,model:execution.model,...request,idempotencyKey:attempt.idempotencyKey});
        if(!Buffer.isBuffer(result.output))throw Object.assign(new Error('Provider did not return image bytes'),{code:'PROVIDER_OUTPUT_INVALID'});
        const ingested=await this.assetIntakeService.ingestProviderOutput({avatar,brandId:scope.brandId,bytes:result.output,
          filename:`l2-${spec.referenceType.toLowerCase()}-${ordinal}.png`,mimeType:result.contentType,provider:execution.provider,
          model:execution.model,attemptId:attempt.id,providerRequestId:result.requestId,consentVerified:true,provenance:{
            provenanceClass:'DERIVED_PROVIDER_OUTPUT',executionLineage:{executionId:execution.id,attemptId:attempt.id,
              generationSpecId:spec.id,identityVersionId:avatar.identityVersionId,identityLockVersionId:identityLock.id,
              certifiedReferenceId:passport.id},assurances:{originalSourceEligible:true,originalSourceGate0Status:'PASS',
              requiredFaceConsent:avatar.subjectType==='SYNTHETIC'?'NOT_REQUIRED':'VALID',identityVersionCurrent:true,
              identityLockCurrent:spec.identityLockVersionId===identityLock.id,providerExecutionApproved:Boolean(execution.approval)},
            identityContract:{permanentSource:'CURRENT_IDENTITY_VERSION_AND_LOCK',
              excludedFromIdentity:['WARDROBE','BACKGROUND','ACCESSORIES','LOCATION','LIGHTING']},
            passportCertificationEventId:passport.id,bodyBuildVersionId:spec.bodyBuildVersionId,
            promptVersion:spec.promptVersion,specVersion:spec.specVersion,repairDelta:spec.repairDelta||null}});
        const role=FAMILIES[execution.generationKind].role;const source=await this.repository.useIntake({avatar,intake:ingested.asset,roles:[role],actor:this.actor});
        const candidate=await this.repository.createGeneratedL2Candidate({family:execution.generationKind,avatar,spec,intake:ingested.asset,source,
          execution,attempt,providerResult:result,actor:this.actor});
        const analyzer=execution.generationKind==='BODY'?analyzeBodyCandidate:execution.generationKind==='EXPRESSION'?analyzeExpressionCandidate:analyzeMouthCandidate;
        const analysis=analyzer({width:ingested.asset.width,height:ingested.asset.height,referenceType:spec.referenceType,
          evidence:{source:'AUTOMATIC_POST_PROVIDER_INGEST',executionId:execution.id,attemptId:attempt.id}});
        const qaSnapshot=await this.repository.createL2QaSnapshot({family:execution.generationKind,candidate,qa:analysis,sourceEvidence:{
          artifactId:candidate.artifactId,artifactVersion:candidate.artifactVersion,identityVersionId:avatar.identityVersionId,
          passportCertificationEventId:passport.id,referenceGeometryContract:'V2.10.2_REFERENCE_GEOMETRY',continuityContract:'V2.10_CONTINUITY_CONTRACT',
          executionId:execution.id,attemptId:attempt.id},actor:this.actor});
        await this.repository.addL2AttemptEvent({execution,attempt,status:'SUCCEEDED',providerRequestId:result.requestId,responseMetadata:{
          artifactId:candidate.artifactId,artifactVersion:candidate.artifactVersion},actor:this.actor});
        await this.repository.createL2ExecutionResult({family:execution.generationKind,execution,attempt,candidate,intake:ingested.asset,providerResult:result,actor:this.actor});
        successes.push(Object.freeze({candidate,qaSnapshot}));
      }catch(error){const classification=String(error.code||'UNKNOWN');await this.repository.addL2AttemptEvent?.({execution,attempt,status:'FAILED',
        failureClassification:['PROVIDER_OUTPUT_INVALID','ARTIFACT_INGEST_FAILED','GATE0_INVALIDATED','CONSENT_INVALIDATED'].includes(classification)?classification:'UNKNOWN',
        safeErrorMessage:'L2 provider execution failed.',actor:this.actor});failures.push(Object.freeze({attemptId:attempt.id,ordinal,classification,safeMessage:'L2 provider execution failed.'}));}
    }
    return Object.freeze({executionId:execution.id,status:successes.length===execution.candidateCount?'GENERATED':successes.length?'PARTIAL_SUCCESS':'FAILED',
      successCount:successes.length,failureCount:failures.length,callsExecuted:execution.candidateCount,successful:Object.freeze(successes),failures:Object.freeze(failures),automaticRetries:0});
  }
}

module.exports={AvatarL2Service,FAMILIES};
