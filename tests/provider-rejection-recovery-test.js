'use strict';
const assert=require('node:assert/strict');
global.fetch=async()=>{throw Error('Unexpected real network access in test');};
const {ReplicateWanVideoAdapter}=require('../src/providers/replicate-wan-video-adapter');
const {rejectedBeforeCreation,legacyResolutionRejection,LEGACY_RESOLUTION_REJECTION}=require('../src/providers/execution-outcome');
const {buildSeedance25Input}=require('../src/providers/replicate-universal-video-adapter');
const {LockedKeyframeService}=require('../src/v2.10/locked-keyframe-service');
const {DurableMediaExecutor}=require('../src/v2.5/durable-media-executor');
const rejection=Object.assign(new Error('invalid resolution'),{code:'REPLICATE_HTTP_ERROR',provider:'replicate',details:{httpStatus:422,operation:'CREATE_PREDICTION',providerExecutionOutcome:'REJECTED_BEFORE_CREATION'}});
async function thrown(fn){try{await fn();throw Error('expected rejection');}catch(e){return e;}}
async function main(){
 for(const status of [400,422,500]){
  let requests=0;
  const a=new ReplicateWanVideoAdapter({apiToken:'test',model:'bytedance/seedance-2.5',fetchImpl:async()=>{
   requests++;return {ok:false,status,text:async()=>JSON.stringify({detail:'invalid input'})};}});
  const e=await thrown(()=>a.runPrediction({input:{},onProviderRequest:()=>{throw Error('rejection must not report a prediction');}}));
  assert.equal(rejectedBeforeCreation(e),status!==500);assert.equal(requests,1,'no automatic create-POST retries');
  const poll=await thrown(()=>a.requestJson('mock-poll',{method:'GET'}));assert(!rejectedBeforeCreation(poll),'poll HTTP422 is not a creation rejection');
 }
 for(const duration of [0,3,31]){
  const e=await thrown(()=>buildSeedance25Input({prompt:'x',duration}));assert(rejectedBeforeCreation(e));
 }
 assert(!rejectedBeforeCreation(rejection,'existing-prediction'));
 let pollCalls=0;
 const accepted=new ReplicateWanVideoAdapter({apiToken:'test',model:'bytedance/seedance-2.5',pollIntervalMs:1,fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify(++pollCalls===1
  ? {id:'accepted-id',status:'processing'} : {id:'accepted-id',status:'failed',error:'invalid input'})})});
 const acceptedFailure=await thrown(()=>accepted.runPrediction({input:{}}));
 assert.equal(acceptedFailure.predictionId,'accepted-id');assert(!rejectedBeforeCreation(acceptedFailure));
 pollCalls=0;
 const callbackFailure=await thrown(()=>accepted.runPrediction({input:{},onProviderRequest:async()=>{throw Error('journal unavailable');}}));
 assert.equal(callbackFailure.predictionId,'accepted-id','accepted ID survives journal callback failure');
 const legacy={stage:'FIRST_VIDEO',status:'NEEDS_RECONCILIATION',boundary_state:'MAY_HAVE_STARTED',error:{code:'REPLICATE_HTTP_ERROR',message:LEGACY_RESOLUTION_REJECTION+'\n'}};
 assert(legacyResolutionRejection(legacy));
 const {HardenedQualityScriptFirstPostgresRepository}=require('../src/v2.10/quality-script-first-repository');
 const repository=Object.create(HardenedQualityScriptFirstPostgresRepository.prototype);
 repository.db={query:async()=>({rows:[legacy]})};
 assert.equal((await repository.assertLockedStageAvailable({stage:'FIRST_VIDEO'})).available,true);
 repository.db={query:async()=>({rows:[{...legacy,id:'unknown',error:{code:'REPLICATE_NETWORK_ERROR'}}]})};
 await assert.rejects(()=>repository.assertLockedStageAvailable({stage:'FIRST_VIDEO'}),e=>e.details.attemptId==='unknown');
 for(const unsafe of [{provider_request_id:'known'}, {result:{media:{artifact:{}}}}, {error:{code:'REPLICATE_NETWORK_ERROR',message:LEGACY_RESOLUTION_REJECTION}}, {status:'RUNNING'}]) assert(!legacyResolutionRejection({...legacy,...unsafe}));
 // Exercise actual stage exception handling, including immutable completion evidence.
 const keyframe={id:'k',version:1,content_hash:'h',storage_key:'immutable/k',validation_status:'PASS',approval_decision:'APPROVED',production_id:'p',shot_id:'s'};
 for(const [failure,status,boundary]of [[rejection,'FAILED','NOT_CROSSED'],[Object.assign(new Error('timeout'),{code:'REPLICATE_NETWORK_ERROR'}),'NEEDS_RECONCILIATION','MAY_HAVE_STARTED']]){
  const service=Object.create(LockedKeyframeService.prototype);let recorded;
  service.scope=async()=>({brandId:'b',workspaceId:'w'});service.draft=async()=>({revision:1,final_preflight:{}});
  service.repository={getKeyframe:async()=>keyframe,getLockedWorkflow:async()=>({id:'wf',production_id:'p'}),
   getLockedStagePreflight:async()=>({fingerprint:'f',draft_revision:1,keyframe_id:'k',keyframe_version:1,keyframe_content_hash:'h'}),
   claimLockedStage:async()=>({id:'attempt'}),markLockedStageBoundary:async()=>{},finishLockedStage:async(v)=>{recorded=v;}};
  service.starter={preflightLockedFirstVideo:async()=>({plan:{fingerprint:'f'}}),startLockedFirstVideo:async({beforeProviderBoundary})=>{await beforeProviderBoundary();throw failure;}};
  await assert.rejects(()=>service.startFirstVideo({id:'d',brandId:'b',keyframeId:'k',preflightId:'pf',fingerprint:'f',confirmation:true}));
  assert.equal(recorded.status,status);assert.equal(recorded.boundaryState,boundary);
 }
 for(const [failure,terminal]of [[rejection,true],[Object.assign(new Error('timeout'),{code:'REPLICATE_NETWORK_ERROR'}),false]]){
  let recorded;const row={id:'m',status:'NOT_STARTED',provider:'replicate',model:'bytedance/seedance-2.5'};
  const executor=new DurableMediaExecutor({repository:{ensure:async()=>row,claim:async()=>row,markBoundary:async()=>row,markFailure:async(v)=>{recorded=v;}},
   providerGateway:{select:()=>({provider:row.provider,model:row.model}),generate:async()=>{throw failure;}},
   artifactService:{getVersionByIdempotency:async()=>null},mediaInspector:{}});
  await assert.rejects(()=>executor.execute({workspaceId:'w',brandId:'b',productionId:'p',workerId:'worker',asset:{asset_id:'v',kind:'video',description:'Test',generation_requirements:{provider:row.provider,model:row.model}}}));
  assert.equal(recorded.terminal,terminal);
 }
 const {V210IntegratedProductionStarter}=require('../src/v2.10/integrated-starter');
 const starter=Object.create(V210IntegratedProductionStarter.prototype);let executedProduction;
 starter.env={LIVE_PAID_GENERATION:'true'};
 starter.lockedFirstVideoProjection=()=>({plan:{fingerprint:'current',executionFingerprint:'execution'},
   canonical:{input:{workspaceId:'w',brandId:'b',qualityVideoProfile:{name:'STANDARD'}}},asset:{asset_id:'video-1'}});
 starter.ensureLockedProduction=async()=>({production:{id:'corrected-production'},job:{id:'job'},runtime:{
   config:{workerId:'worker'},mediaExecutor:{execute:async(args)=>{executedProduction=args.productionId;return {provider:'replicate',model:'seedance'};}},
   visualQualityEvaluator:{evaluate:async()=>({status:'PASS'})}}});
 const pilot=await starter.startLockedFirstVideo({draft:{},preflight:{},keyframe:{},actor:'test',productionId:'original-keyframe-production',expectedFingerprint:'current'});
 assert.equal(executedProduction,'corrected-production');assert.equal(pilot.productionId,'corrected-production');
 console.log('PASS: create POST vs poll rejection, local validation, no auto retries, stage/media outcome classification, timeout fencing and strict legacy evidence. Real HTTP calls: 0.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
