'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { AvatarAssetIntakeService } = require('../src/avatar-studio/asset-intake-service');
const { PassportExecutionService, safeFailure } = require('../src/avatar-studio/passport-execution-service');
const { PASSPORT_PROMPT_VERSION, PASSPORT_SPEC_VERSION } = require('../src/avatar-studio/passport-plan-compiler');
const { evaluateAvatarLevels } = require('../src/avatar-studio/level-engine');

const WORKSPACE='11111111-1111-4111-8111-111111111111';
const BRAND='22222222-2222-4222-8222-222222222222';
const AVATAR='33333333-3333-4333-8333-333333333333';
const IDENTITY='44444444-4444-4444-8444-444444444444';
const LOCK='55555555-5555-4555-8555-555555555555';
const SPEC='66666666-6666-4666-8666-666666666666';
const VERTICAL='PSYCHOLOGY_WELLBEING';

function png(width=3000,height=1000,tail='') {
  const bytes=Buffer.alloc(64+Buffer.byteLength(tail));
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  bytes.writeUInt32BE(13,8); Buffer.from('IHDR').copy(bytes,12); bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20);
  Buffer.from(tail).copy(bytes,64); return bytes;
}

class MemoryRepository {
  constructor() {
    this.avatar={id:AVATAR,workspaceId:WORKSPACE,internalName:'Synthetic Mara',verticalCode:VERTICAL,vertical:VERTICAL,identityVersionId:IDENTITY,
      version:1,subjectType:'SYNTHETIC',identity:{agePresentation:'late 30s',personality:'calm',role:'expert',languages:['en'],
        visualDirection:'natural',prohibitedUses:['deception']},brandIds:[BRAND],brandPermissions:[{brandId:BRAND,allowed:true}],
      consent:{status:'APPROVED'},consentRecords:[{status:'APPROVED'}],consentEvents:[],
      sources:[],identityLocks:[{id:LOCK,identityVersionId:IDENTITY}],passportCertificationEvents:[],passports:[],passportCandidates:[],
      bodyReferences:[],expressionReferences:[],wardrobes:[],voiceProfiles:[],locations:[],performancePacks:[],continuityReadiness:[]};
    this.spec={id:SPEC,workspaceId:WORKSPACE,brandId:BRAND,verticalCode:VERTICAL,characterId:AVATAR,
      identityVersionId:IDENTITY,identityLockVersionId:LOCK,sourceAssetIds:['source-1'],requestedCandidateCount:4,
      studioSpecification:{composition:'ONE_HORIZONTAL_THREE_PANEL_COMPOSITE'},cameraSpecification:{height:'EYE_LEVEL'},
      identityConstraints:{nose:'preserve'},negativeConstraints:{canonical:'no text',temporaryExclusions:{hat:'exclude'}},
      preferredProvider:'openai',preferredModel:'gpt-image-1',promptVersion:PASSPORT_PROMPT_VERSION,
      specVersion:PASSPORT_SPEC_VERSION,planFingerprint:'plan-fingerprint',costPlan:{status:'UNKNOWN',knownPricePerCandidate:null},
      repairDelta:null,originalGenerationSpecId:null};
    this.sources=new Map([['source-1',{id:'source-1',brandId:BRAND,characterId:AVATAR,intakeAssetId:'source-intake',
      artifactId:'source-artifact',artifactVersion:1,gate0Status:'PASS',roles:['IDENTITY','PASSPORT_SOURCE']}]]);
    this.intakes=new Map(); this.executions=new Map(); this.attempts=[]; this.candidates=[]; this.qa=[]; this.results=[];
  }
  async getCharacter({id,brandId}) { return id===AVATAR&&brandId===BRAND?this.avatar:null; }
  async generationSpec({id,avatarId,brandId}) { return id===this.spec.id&&avatarId===AVATAR&&brandId===BRAND?this.spec:null; }
  async source({id,avatarId}) { const value=this.sources.get(id); return value?.characterId===avatarId?value:null; }
  async intake({id,brandId,avatarId}) { const value=this.intakes.get(id); return value?.brandId===brandId&&value?.characterId===avatarId?value:null; }
  async createIntake({id,avatar,brandId,artifact,media,sourceType,sourceLocator,gate0,rightsStatus,provenance,actor}) {
    const value={id,workspaceId:avatar.workspaceId,brandId,verticalCode:avatar.vertical,characterId:avatar.id,
      artifactId:artifact.artifactId,artifactVersion:artifact.version,artifactStorageKey:artifact.storageKey,
      contentHash:artifact.contentHash,originalFilename:media.filename,mimeType:media.mimeType,extension:media.extension,
      byteSize:media.byteSize,width:media.width,height:media.height,durationMs:media.durationMs,sourceType,sourceLocator,
      gate0Status:gate0.status,effectiveGate0Status:gate0.status,gate0Findings:gate0.findings,gate0PolicyVersion:gate0.policyVersion,
      rightsStatus,effectiveRightsStatus:rightsStatus,provenance,uploader:actor,effectiveConsents:[]};
    this.intakes.set(id,value); return value;
  }
  async useIntake({avatar,intake,roles}) { const id=`generated-source-${this.sources.size}`; const value={id,workspaceId:avatar.workspaceId,
    brandId:intake.brandId,characterId:avatar.id,intakeAssetId:intake.id,artifactId:intake.artifactId,
    artifactVersion:intake.artifactVersion,contentHash:intake.contentHash,gate0Status:'PASS',roles}; this.sources.set(id,value); return value; }
  async createPassportExecution({preflight,actor}) { const s=preflight.snapshot; const id=crypto.randomUUID(); const value={id,
    workspaceId:s.workspaceId,brandId:s.brandId,verticalCode:s.vertical,characterId:s.avatarId,identityVersionId:s.identityVersionId,
    identityLockVersionId:s.identityLockVersionId,generationSpecId:s.generationSpecId,provider:s.provider,model:s.model,
    adapterFamily:s.adapterFamily,capability:s.capability,profile:s.profile,candidateCount:s.candidateCount,
    callsPerCandidate:s.callsPerCandidate,totalPlannedCalls:s.totalPlannedCalls,costPlan:s.costPlan,
    maximumAllowedCost:s.maximumAllowedCost,inputSnapshot:s,preflightFingerprint:preflight.preflightFingerprint,
    createdBy:actor,events:[],attempts:[],results:[],approval:null}; this.executions.set(id,value); return value; }
  async addPassportExecutionEvent({execution,status,details}) { const event={id:crypto.randomUUID(),status,details}; execution.events.push(event); execution.status=status; return event; }
  async createPassportExecutionApproval({execution,preflight,unknownCostAcknowledged,actor}) { const s=preflight.snapshot;
    const value={id:crypto.randomUUID(),executionId:execution.id,preflightFingerprint:preflight.preflightFingerprint,
      maximumAllowedCost:s.maximumAllowedCost,knownTotalCost:s.costPlan.knownTotalCost,unknownCostAcknowledged,
      exactProposal:s,approvedBy:actor,approvedAt:new Date().toISOString()}; execution.approval=value; return value; }
  async passportExecution({id,workspaceId,brandId,vertical,avatarId,identityVersionId}) { const e=this.executions.get(id);
    return e&&e.workspaceId===workspaceId&&e.brandId===brandId&&e.verticalCode===vertical&&e.characterId===avatarId
      &&e.identityVersionId===identityVersionId?e:null; }
  async createPassportProviderAttempt({execution,ordinal,request}) { const value={id:crypto.randomUUID(),workspaceId:execution.workspaceId,
    brandId:execution.brandId,characterId:execution.characterId,executionId:execution.id,candidateOrdinal:ordinal,
    provider:execution.provider,model:execution.model,adapterFamily:execution.adapterFamily,
    idempotencyKey:`passport:${execution.id}:${ordinal}`,requestFingerprint:request.requestFingerprint,events:[]};
    this.attempts.push(value); execution.attempts.push(value); return value; }
  async addPassportProviderAttemptEvent({attempt,...event}) { const value={id:crypto.randomUUID(),...event}; attempt.events.push(value); attempt.latestStatus=value.status; return value; }
  async createGeneratedPassportCandidate({avatar,generationSpec,intake,source,execution,attempt,providerResult}) {
    const value={id:crypto.randomUUID(),workspaceId:avatar.workspaceId,brandId:execution.brandId,verticalCode:avatar.vertical,
      characterId:avatar.id,identityVersionId:generationSpec.identityVersionId,identityLockVersionId:generationSpec.identityLockVersionId,
      generationSpecId:generationSpec.id,intakeAssetId:intake.id,sourceAssetId:source.id,artifactId:intake.artifactId,
      artifactVersion:intake.artifactVersion,provider:execution.provider,model:execution.model,providerRequestId:providerResult.requestId,
      promptVersion:generationSpec.promptVersion,specVersion:generationSpec.specVersion,provenance:{executionId:execution.id,
        attemptId:attempt.id,sourceAssetIds:generationSpec.sourceAssetIds,identityVersionId:generationSpec.identityVersionId,
        identityLockVersionId:generationSpec.identityLockVersionId}}; this.candidates.push(value); this.avatar.passportCandidates.push(value); return value; }
  async createPassportQaSnapshot({candidate,qa,sourceEvidence}) { const value={id:crypto.randomUUID(),candidateId:candidate.id,...qa,sourceEvidence};
    this.qa.push(value); candidate.qaStatus=qa.status; candidate.qaSnapshotId=value.id; return value; }
  async createPassportExecutionResult({execution,attempt,candidate,artifact}) { const value={id:crypto.randomUUID(),executionId:execution.id,
    attemptId:attempt.id,candidateId:candidate.id,artifactId:artifact.artifactId,artifactVersion:artifact.version,
    contentHash:artifact.contentHash,storageKey:artifact.storageKey}; this.results.push(value); execution.results.push(value); return value; }
}

function scope() { return {workspaceId:WORKSPACE,brandId:BRAND,vertical:VERTICAL,avatarId:AVATAR,identityVersionId:IDENTITY}; }
function catalog({configured=true,capable=true}={}) { return { resolveSelection({provider,model,capability}) {
  if(!configured)throw Object.assign(new Error('OpenAI credentials are not configured'),{code:'CREDENTIALS_MISSING',status:409});
  if(!capable||capability!=='MULTI_VIEW_IDENTITY_REFERENCE')throw Object.assign(new Error('Capability unavailable'),{code:'CAPABILITY_UNSUPPORTED',status:409});
  return {provider,model,adapterFamily:'openai-media',profile:'PREMIUM',capability,configurationStatus:'CONFIGURED'}; } }; }

async function fixture({gateway,catalogOptions}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'avatar-passport-execution-'));
  const storage=new FilesystemStorageAdapter({root:directory}); const artifacts=new ArtifactService({storage}); const repository=new MemoryRepository();
  const sourceBytes=png(1200,1200,'source'); const sourceArtifact=await artifacts.createVersion({artifactId:'source-artifact',type:'binary',
    content:sourceBytes,stageId:'TEST',attemptId:'source'});
  repository.intakes.set('source-intake',{id:'source-intake',workspaceId:WORKSPACE,brandId:BRAND,verticalCode:VERTICAL,
    characterId:AVATAR,artifactId:'source-artifact',artifactVersion:sourceArtifact.version,artifactStorageKey:sourceArtifact.storageKey,
    contentHash:sourceArtifact.contentHash,originalFilename:'source.png',mimeType:'image/png',width:1200,height:1200,
    effectiveGate0Status:'PASS',gate0Status:'PASS',effectiveRightsStatus:'NOT_REQUIRED',effectiveConsents:[],provenance:{}});
  let mockCalls=0;
  const providerGateway=gateway||{async generate({idempotencyKey}){mockCalls+=1; const ordinal=Number(idempotencyKey.split(':').at(-1));
    return {provider:'openai-media',model:'gpt-image-1',capability:'multi-view-identity-reference',output:png(3000,1000,`candidate-${ordinal}`),
      contentType:'image/png',requestId:`mock-request-${ordinal}`,usage:null,provenance:{mock:true}};}};
  const intakeService=new AvatarAssetIntakeService({repository,artifactService:artifacts,storage,actor:'test-operator'});
  const service=new PassportExecutionService({repository,providerCatalog:catalog(catalogOptions),providerGateway,
    assetIntakeService:intakeService,storage,actor:'test-operator'});
  return {directory,storage,artifacts,repository,service,get mockCalls(){return mockCalls;}};
}

async function approveReady(fx,{count=4,budget=10}={}) {
  const preflight=await fx.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:budget,executionCandidateCount:count});
  await fx.service.approve({...scope(),executionId:preflight.executionId,explicitConfirmation:true,unknownCostAcknowledged:true});
  return preflight;
}

async function main() {
  let realPaidCalls=0,realImageCalls=0,realVideoCalls=0,realVoiceCalls=0,externalRealCalls=0;
  const fx=await fixture();
  try {
    const preflight=await fx.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:10,executionCandidateCount:4});
    assert.equal(fx.mockCalls,0,'preflight causes zero provider calls');
    assert.equal(preflight.callsPerCandidate,1); assert.equal(preflight.totalPlannedCalls,4);
    assert.equal(preflight.costPlan.status,'UNKNOWN'); assert.equal(preflight.costPlan.knownTotalCost,null);
    assert.equal(preflight.costPlan.unknownIsZero,false); assert(preflight.costPlan.unknownElements.includes('TOTAL_COST'));
    const smokeProposal=await fx.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:10,executionCandidateCount:1});
    assert.notEqual(smokeProposal.preflightFingerprint,preflight.preflightFingerprint,
      'candidate count changes the exact approval proposal');
    await assert.rejects(()=>fx.service.generate({...scope(),executionId:preflight.executionId}),
      (e)=>e.code==='EXECUTION_APPROVAL_REQUIRED');
    await assert.rejects(()=>fx.service.approve({...scope(),executionId:preflight.executionId,explicitConfirmation:true}),
      (e)=>e.code==='UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED');
    const approved=await fx.service.approve({...scope(),executionId:preflight.executionId,explicitConfirmation:true,unknownCostAcknowledged:true});
    assert.equal(fx.mockCalls,0,'approval causes zero provider calls'); assert.equal(approved.status,'APPROVED');
    const generated=await fx.service.generate({...scope(),executionId:preflight.executionId});
    assert.equal(generated.status,'GENERATED',JSON.stringify(generated.failures)); assert.equal(generated.successCount,4); assert.equal(fx.mockCalls,4);
    assert.equal(fx.repository.candidates.length,4); assert.equal(fx.repository.qa.length,4); assert.equal(fx.repository.results.length,4);
    assert(fx.repository.candidates.every((candidate)=>candidate.provenance.executionId===preflight.executionId));
    assert(fx.repository.candidates.every((candidate)=>candidate.provenance.sourceAssetIds[0]==='source-1'));
    assert.equal(evaluateAvatarLevels(fx.repository.avatar).currentLevel,0,'generated candidates and automatic QA remain L0');
    fx.repository.candidates[0].humanReviewState='HUMAN_REJECTED'; fx.repository.candidates[1].humanReviewState='KEPT';
    assert.equal(evaluateAvatarLevels(fx.repository.avatar).currentLevel,0,'KEEP remains L0');
    fx.repository.avatar.passportCertificationEvents.push({identityVersionId:IDENTITY,identityLockVersionId:LOCK,explicitConfirmation:true,
      candidateId:fx.repository.candidates[1].id});
    assert.equal(evaluateAvatarLevels(fx.repository.avatar).currentLevel,1,'explicit human certification creates L1');
    assert.equal(new Set(fx.repository.results.map((item)=>item.storageKey)).size,4,'generated artifacts have immutable unique storage keys');
    await assert.rejects(()=>fx.storage.put({key:fx.repository.results[0].storageKey,bytes:png()}),(e)=>e.code==='EEXIST');
    await assert.rejects(()=>fx.service.generate({...scope(),executionId:preflight.executionId}),
      (e)=>e.code==='EXECUTION_ALREADY_ATTEMPTED','no automatic or duplicate retry spending');
  } finally { await fs.rm(fx.directory,{recursive:true,force:true}); }

  const stale=await fixture();
  try {
    const preflight=await approveReady(stale,{count:1}); stale.repository.intakes.get('source-intake').contentHash='changed';
    await assert.rejects(()=>stale.service.generate({...scope(),executionId:preflight.executionId}),(e)=>e.code==='STALE_APPROVAL');
    assert.equal(stale.mockCalls,0,'stale source approval blocks before provider');
  } finally { await fs.rm(stale.directory,{recursive:true,force:true}); }

  for (const mutation of [
    (r)=>{r.avatar.identityLocks=[{id:'new-lock',identityVersionId:IDENTITY}];},
    (r)=>{r.spec.promptVersion='new-prompt';}, (r)=>{r.spec.specVersion='new-spec';},
    (r)=>{r.spec.preferredProvider='other';}, (r)=>{r.spec.preferredModel='other-model';},
    (r)=>{r.spec.repairDelta={reason:'PROFILE_DRIFT'};}, (r)=>{r.spec.costPlan={status:'KNOWN',knownPricePerCandidate:20};},
  ]) {
    const item=await fixture(); try { const p=await approveReady(item,{count:1}); mutation(item.repository);
      await assert.rejects(()=>item.service.generate({...scope(),executionId:p.executionId})); assert.equal(item.mockCalls,0);
    } finally { await fs.rm(item.directory,{recursive:true,force:true}); }
  }

  const identity=await fixture(); try { const p=await approveReady(identity,{count:1}); identity.repository.avatar.identityVersionId='new-identity';
    await assert.rejects(()=>identity.service.generate({...scope(),executionId:p.executionId}),(e)=>e.code==='PASSPORT_EXECUTION_SCOPE_MISMATCH');
  } finally { await fs.rm(identity.directory,{recursive:true,force:true}); }

  const consent=await fixture(); try { consent.repository.avatar.subjectType='CONSENTED_REAL_PERSON';
    await assert.rejects(()=>consent.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:10,executionCandidateCount:1}),
      (e)=>e.code==='CONSENT_INVALIDATED');
  } finally { await fs.rm(consent.directory,{recursive:true,force:true}); }

  for (const badScope of [{...scope(),workspaceId:'other-workspace'},{...scope(),brandId:'other-brand'},
    {...scope(),vertical:'TRAVEL'}, {...scope(),avatarId:'other-avatar'}]) {
    const isolated=await fixture(); try { await assert.rejects(()=>isolated.service.preflight({...badScope,generationSpecId:SPEC,
      maximumAllowedCost:10,executionCandidateCount:1}),(e)=>['PASSPORT_EXECUTION_SCOPE_MISMATCH','PASSPORT_GENERATION_SPEC_NOT_FOUND'].includes(e.code));
    } finally { await fs.rm(isolated.directory,{recursive:true,force:true}); }
  }
  const missingScope=await fixture(); try { await assert.rejects(()=>missingScope.service.preflight({generationSpecId:SPEC,
    maximumAllowedCost:10,executionCandidateCount:1}),(e)=>e.code==='PASSPORT_EXECUTION_SCOPE_REQUIRED');
  } finally { await fs.rm(missingScope.directory,{recursive:true,force:true}); }

  const cancelled=await fixture(); try { const p=await cancelled.service.preflight({...scope(),generationSpecId:SPEC,
    maximumAllowedCost:10,executionCandidateCount:1}); const result=await cancelled.service.cancel({...scope(),executionId:p.executionId});
    assert.equal(result.status,'CANCELLED'); assert.equal(cancelled.mockCalls,0);
  } finally { await fs.rm(cancelled.directory,{recursive:true,force:true}); }

  const gate=await fixture(); try { const p=await approveReady(gate,{count:1}); gate.repository.sources.get('source-1').gate0Status='BLOCK';
    await assert.rejects(()=>gate.service.generate({...scope(),executionId:p.executionId}),(e)=>e.code==='GATE0_INVALIDATED');
  } finally { await fs.rm(gate.directory,{recursive:true,force:true}); }

  const cost=await fixture(); try { cost.repository.spec.costPlan={status:'KNOWN',knownPricePerCandidate:2};
    const p=await cost.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:8,executionCandidateCount:4});
    assert.equal(p.costPlan.knownTotalCost,8); assert.equal(p.costPlan.knownPricePerCall,2);
    await assert.rejects(()=>cost.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:7,executionCandidateCount:4}),
      (e)=>e.code==='BUDGET_EXCEEDED');
  } finally { await fs.rm(cost.directory,{recursive:true,force:true}); }

  for (const options of [{configured:false},{capable:false}]) { const blocked=await fixture({catalogOptions:options}); try {
    await assert.rejects(()=>blocked.service.preflight({...scope(),generationSpecId:SPEC,maximumAllowedCost:10,executionCandidateCount:1}));
  } finally { await fs.rm(blocked.directory,{recursive:true,force:true}); } }

  const partial=await fixture({gateway:{calls:0,async generate({idempotencyKey}){this.calls+=1; const ordinal=Number(idempotencyKey.split(':').at(-1));
    if(ordinal===4)throw Object.assign(new Error('timeout'),{code:'PROVIDER_TIMEOUT'});
    return {provider:'openai-media',model:'gpt-image-1',output:png(3000,1000,`partial-${ordinal}`),contentType:'image/png',requestId:`partial-${ordinal}`};}}});
  try { const p=await approveReady(partial); const result=await partial.service.generate({...scope(),executionId:p.executionId});
    assert.equal(result.status,'PARTIAL_SUCCESS'); assert.equal(result.successCount,3); assert.equal(result.failureCount,1);
    assert.equal(partial.repository.candidates.length,3); assert.equal(result.automaticRetries,0); assert.equal(partial.repository.attempts.length,4);
    assert.equal(result.failures[0].classification,'PROVIDER_TIMEOUT');
  } finally { await fs.rm(partial.directory,{recursive:true,force:true}); }

  const invalid=await fixture({gateway:{async generate(){return {provider:'openai-media',model:'gpt-image-1',
    output:Buffer.from('not-an-image'),contentType:'image/png',requestId:'invalid'};}}});
  try { const p=await approveReady(invalid,{count:1}); const result=await invalid.service.generate({...scope(),executionId:p.executionId});
    assert.equal(result.status,'FAILED'); assert.equal(result.failures[0].classification,'PROVIDER_OUTPUT_INVALID');
    assert.equal(invalid.repository.candidates.length,0); assert.equal(invalid.repository.attempts[0].events.at(-1).status,'FAILED');
  } finally { await fs.rm(invalid.directory,{recursive:true,force:true}); }

  const providerFailure=await fixture({gateway:{calls:0,async generate(){this.calls+=1;throw new Error('opaque mock failure');}}});
  try { const p=await approveReady(providerFailure,{count:1}); const result=await providerFailure.service.generate({...scope(),executionId:p.executionId});
    assert.equal(result.status,'FAILED'); assert.equal(result.failures[0].classification,'UNKNOWN');
    assert.equal(providerFailure.repository.attempts.length,1); assert.equal(providerFailure.repository.attempts[0].events.length,2,
      'failed attempt retains STARTED and FAILED evidence without retry');
  } finally { await fs.rm(providerFailure.directory,{recursive:true,force:true}); }

  assert.equal(safeFailure({status:429}).classification,'PROVIDER_RATE_LIMIT');
  assert.equal(safeFailure({status:401}).classification,'PROVIDER_AUTH');
  assert.equal(safeFailure({code:'CAPABILITY_UNSUPPORTED'}).classification,'PROVIDER_CAPABILITY');
  assert(!safeFailure(Object.assign(new Error('Bearer sk-secret-value'),{code:'UNKNOWN'})).safeMessage.includes('sk-secret-value'),
    'provider errors returned to API must not echo secrets');
  assert.equal(realPaidCalls,0); assert.equal(realImageCalls,0); assert.equal(realVideoCalls,0); assert.equal(realVoiceCalls,0); assert.equal(externalRealCalls,0);
  console.log('Avatar Studio V1.2.1 controlled Passport execution passed: immutable preflight/approval, stale guards, budget, mock success/partial/failure, auto-ingest/QA, strict L0→L1; real paid calls = 0; real image calls = 0; real external generation calls = 0');
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
