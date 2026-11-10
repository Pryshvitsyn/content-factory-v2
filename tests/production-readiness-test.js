'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
global.fetch = async () => { throw Error('Real network forbidden in this test'); };
const compiler = require('../src/v2.8/provider-request-compiler');
const { createCanonicalMediaRequest, fromAsset } = require('../src/v2.8/canonical-media-request');
const { ReplicateWanVideoAdapter } = require('../src/providers/replicate-wan-video-adapter');
const { ReplicateUniversalVideoAdapter } = require('../src/providers/replicate-universal-video-adapter');
const { AsyncMediaProviderAdapter } = require('../src/v2.8/async-media-provider-adapter');
const { createVideoAdapter } = require('../src/v2.8/provider-adapter-factory');
const { PROTOCOLS } = require('../src/v2.8/provider-protocols');
const { createOpenAIMediaProvider } = require('../src/providers/openai-media-provider');
const { createElevenLabsTtsProvider } = require('../src/providers/elevenlabs-tts-provider');
const { DurableMediaExecutor } = require('../src/v2.5/durable-media-executor');
const { LockedKeyframeService } = require('../src/v2.10/locked-keyframe-service');
const { terminalProviderFailure, rejectedBeforeCreation } = require('../src/providers/execution-outcome');
const { resolveAuthoritativeVideo } = require('../src/v2.10/runtime-integration');
let groups = 0;
async function check(name, fn) { await fn(); console.log('PASS', name); groups++; }
const json = body => ({ ok:true, status:200, text:async()=>JSON.stringify(body), arrayBuffer:async()=>Buffer.from('video') });
const env = { REPLICATE_API_TOKEN:'synthetic', FAL_KEY:'synthetic', RUNWAYML_API_SECRET:'synthetic', LUMA_API_KEY:'synthetic', DASHSCOPE_API_KEY:'synthetic', ALIBABA_MODEL_STUDIO_REGION:'singapore', ALIBABA_MODEL_STUDIO_WORKSPACE_ID:'test-workspace' };
function request(provider,model,extra={}) { return createCanonicalMediaRequest({ prompt:'An empty sunlit kitchen.', providerPrompt:'An empty sunlit kitchen.', capability:'TEXT_TO_VIDEO', durationSeconds:5, resolution:'720p', aspectRatio:'9:16', providerSelection:{provider,model,profile:'STANDARD'}, ...extra }); }
function family(provider,model) { return provider==='replicate' ? model.includes('wan-2.2')?'replicate-wan':model.includes('wan-3')?'replicate-wan-3':'replicate-seedance-2.5' : ({fal:'fal-video',runway:'runway-video',luma:'luma-video',alibaba:'dashscope-video'})[provider]; }
function asset(extra={}) { return {asset_id:'video-1',kind:'video',description:'A room.',generation_requirements:{provider:'replicate',model:'bytedance/seedance-2.5',profile:'STANDARD',capability:'TEXT_TO_VIDEO',prompt:'A room.',resolution:'720p',aspect_ratio:'9:16',target_clip_duration_ms:5000,request_compiler_version:compiler.COMPILER_VERSION,...extra}}; }
async function main() {
 await check('all eight video adapters send exactly the certified payload; changed payload sends zero requests', async()=>{
  for(const key of Object.keys(compiler.CONTRACTS)) {
   const slash=key.indexOf('/'),provider=key.slice(0,slash),model=key.slice(slash+1);
   let calls=0,body;
   const adapter=createVideoAdapter({provider,model,adapterFamily:family(provider,model)}, {env,fetchImpl:async(_url,options)=>{calls++;body=JSON.parse(options.body);throw Error('mock transport stop');}});
   const req=request(provider,model), certified=compiler.compileVideoRequest(req,{env});
   await assert.rejects(()=>adapter.generate({capability:'video-generation',canonicalRequest:{...req,expectedProviderRequest:certified.summary},model}));
   assert.equal(calls,1,key);assert.deepEqual(body,certified.payload,key);
   calls=0;
   await assert.rejects(()=>adapter.generate({capability:'video-generation',canonicalRequest:{...req,providerPrompt:'Changed action.',expectedProviderRequest:certified.summary},model}),e=>e.code==='STALE_PROVIDER_PREFLIGHT');
   assert.equal(calls,0,key);
  }
 });
 await check('Seedance reference eligibility blocks materialized and deferred media without a paid call or bypass flag', async()=>{
  const r=request('replicate','bytedance/seedance-2.5',{capability:'IMAGE_TO_VIDEO',references:{firstFrame:'data:image/png;base64,YQ=='}});
  let calls=0;const adapter=new ReplicateUniversalVideoAdapter({family:'SEEDANCE_2_5',model:r.providerSelection.model,apiToken:'synthetic',fetchImpl:async()=>{calls++;}});
  await assert.rejects(()=>adapter.generate({canonicalRequest:{...r,aiGenerated:true,portraitApproved:true}}),e=>e.code==='REFERENCE_ELIGIBILITY_UNVERIFIED');assert.equal(calls,0);
  const report=compiler.collectProviderPreflight([asset({capability:'IMAGE_TO_VIDEO',v210_reference:{policy:'UPLOADED_REFERENCE'}})]);
  assert.equal(report[0].code,'REFERENCE_ELIGIBILITY_UNVERIFIED');assert(!report[0].fingerprint);
 });
 await check('replicate accepted ID is durable before polling and survives privacy refusal, malformed status and failed GET',async()=>{
  for(const mode of ['privacy','malformed','network']) {
   const events=[];let calls=0;
   const adapter=new ReplicateWanVideoAdapter({apiToken:'synthetic',model:'bytedance/seedance-2.5',maxHttpRetries:0,pollIntervalMs:1,sleep:async()=>{},fetchImpl:async(_url,options)=>{
    calls++;events.push(options.method);
    if(options.method==='POST')return json({id:'replicate-prediction',...(mode==='malformed'?{}:{status:'processing'})});
    if(mode==='network')throw Error('poll offline');
    return json({id:'replicate-prediction',status:'failed',error:'E005 InputImageSensitiveContentDetected.PrivacyInformation upstream request id: not-the-prediction'});
   }});
   let error;try {await adapter.runPrediction({input:{},onProviderRequest:async({requestId})=>{assert.equal(requestId,'replicate-prediction');events.push('journal');}});}catch(e){error=e;}
   assert.equal(error.predictionId,'replicate-prediction');assert.deepEqual(events.slice(0,2),['POST','journal']);
   assert.equal(terminalProviderFailure(error),mode==='privacy');assert(!rejectedBeforeCreation(error));
   if(mode==='privacy')assert.equal(error.details.failureKind,'REFERENCE_PRIVACY_REFUSAL');
   assert.equal(events.filter(x=>x==='POST').length,1);assert(calls<=2);
  }
 });
 await check('async accepted ID survives polling, download and journal failures',async()=>{
  for(const mode of ['poll','download','journal','terminal']) {
   const adapter=new AsyncMediaProviderAdapter({protocol:PROTOCOLS.runway,credential:'synthetic',sleep:async()=>{},fetchImpl:async(url,options)=>{
    if(options.method==='POST')return json({id:'accepted-runway'});
    if(mode==='poll'||url.endsWith('.mp4'))throw Error('mock failure');
    return json({id:'accepted-runway',status:mode==='terminal'?'FAILED':'SUCCEEDED',output:['https://media.test/video.mp4']});
   }});
   await assert.rejects(()=>adapter.generate({canonicalRequest:request('runway','gen4.5'),onProviderRequest:async()=>{if(mode==='journal')throw Error('journal down');}}),e=>e.predictionId==='accepted-runway'&&terminalProviderFailure(e)===(mode==='terminal'));
  }
 });
 await check('OpenAI image and speech use exact compiled bodies with creation retries disabled',async()=>{
  for(const capability of ['image-generation','speech-generation']) {
   const model=capability==='image-generation'?'gpt-image-1.5':'gpt-4o-mini-tts', a={description:'A quiet room.',generation_requirements:{prompt:'A quiet room.',text:'Hello.',voice:'alloy'}};
   const compiled=compiler.compileAuxiliaryRequest({asset:a,capability,provider:'openai',model});let calls=0;
   const client={images:{generate:async(body,options)=>{calls++;assert.deepEqual(body,compiled.payload);assert.equal(options.maxRetries,0);return {id:'image-id',data:[{b64_json:'aGk='}]};}},audio:{speech:{create:async(body,options)=>{calls++;assert.deepEqual(body,compiled.payload);assert.equal(options.maxRetries,0);return {headers:{get:()=> 'voice-id'},arrayBuffer:async()=>Buffer.from('hi')};}}}};
   const provider=createOpenAIMediaProvider({client});a.generation_requirements.provider_request_preflight=compiled.summary;
   await provider.generate({capability,model,prompt:JSON.stringify(a)});assert.equal(calls,1);
   a.generation_requirements[capability==='image-generation'?'prompt':'text']='Changed.';
   await assert.rejects(()=>provider.generate({capability,model,prompt:JSON.stringify(a)}),e=>e.code==='STALE_PROVIDER_PREFLIGHT');assert.equal(calls,1);
  }
 });
 await check('ElevenLabs never automatically retries an ambiguous creation and records accepted ID before reading bytes',async()=>{
  let calls=0;const a={generation_requirements:{text:'Hello.',voice_id:'voice-123'}};
  const adapter=createElevenLabsTtsProvider({apiKey:'synthetic',maxHttpRetries:10,sleep:async()=>{},fetchImpl:async()=>{calls++;throw Error('connection lost');}});
  await assert.rejects(()=>adapter.generate({capability:'speech-generation',prompt:JSON.stringify(a)}));assert.equal(calls,1);
  const events=[];const accepted=createElevenLabsTtsProvider({apiKey:'synthetic',fetchImpl:async()=>({ok:true,status:200,headers:{get:()=> 'accepted-voice'},arrayBuffer:async()=>{events.push('read');throw Error('download failed');}})});
  await assert.rejects(()=>accepted.generate({capability:'speech-generation',prompt:JSON.stringify(a),onProviderRequest:async()=>events.push('journal')}),e=>e.predictionId==='accepted-voice');assert.deepEqual(events,['journal','read']);
 });
 await check('all image and speech assets are included, unknown providers fail closed',()=>{
  const report=compiler.collectProviderPreflight([{asset_id:'image',kind:'image',generation_requirements:{provider:'openai',model:'gpt-image-1.5',prompt:'x'.repeat(32001)}},{asset_id:'voice',kind:'voice',generation_requirements:{provider:'unknown',model:'unknown',text:'Hello.'}}]);
  assert.equal(report.length,2);assert(report.every(x=>x.status==='BLOCKED'));
 });
 await check('a global frame-continuity requirement cannot silently become text-only on shots two and three',async()=>{
  const brief={continuity:{referencePolicy:'PREVIOUS_SHOT_FRAME'},storyboard:[1,2,3].map(n=>({shotId:'shot-'+n,assetId:'video-'+n,referencePolicy:n===1?'UPLOADED_REFERENCE':'NONE'}))};
  await assert.rejects(()=>resolveAuthoritativeVideo({catalog:{forWorkspace:async()=>{throw Error('must block before catalog');}},workspaceId:'w',brief}),e=>e.code==='REFERENCE_PLAN_CONFLICT'&&e.details.affectedShots.join(',')==='shot-2,shot-3');
 });
 await check('authorization metadata does not change pilot media identity',()=>{
  const executor=Object.create(DurableMediaExecutor.prototype), a=asset(), args={brandId:'b',productionId:'p',asset:a};
  const first=executor.identities(args);a.generation_requirements.provider_request_preflight={fingerprint:'authorization-only'};
  assert.equal(executor.identities(args).fingerprint,first.fingerprint);a.generation_requirements.prompt='Different.';assert.notEqual(executor.identities(args).fingerprint,first.fingerprint);
 });
 await check('the enclosing stage receives the accepted ID before provider terminal failure',async()=>{
  const svc=Object.create(LockedKeyframeService.prototype),events=[];let outcome;
  svc.scope=async()=>({brandId:'b',workspaceId:'w'});svc.draft=async()=>({revision:1,final_preflight:{}});
  const frame={id:'k',version:1,content_hash:'h',storage_key:'k',validation_status:'PASS',approval_decision:'APPROVED',shot_id:'s'};
  svc.repository={getKeyframe:async()=>frame,getLockedWorkflow:async()=>({id:'wf'}),getLockedStagePreflight:async()=>({fingerprint:'f',draft_revision:1,keyframe_id:'k',keyframe_version:1,keyframe_content_hash:'h'}),claimLockedStage:async()=>({id:'a'}),markLockedStageBoundary:async()=>events.push('boundary'),recordLockedStageProviderRequest:async v=>events.push(v.providerRequestId),finishLockedStage:async v=>outcome=v};
  svc.starter={preflightLockedFirstVideo:async()=>({plan:{fingerprint:'f'}}),startLockedFirstVideo:async({beforeProviderBoundary,onProviderRequest})=>{await beforeProviderBoundary();await onProviderRequest({requestId:'provider-id'});throw Object.assign(Error('refused'),{code:'PROVIDER_FAILED',predictionId:'provider-id',details:{providerExecutionOutcome:'TERMINAL_FAILURE',requestId:'provider-id',providerStatus:'failed'}});}};
  await assert.rejects(()=>svc.startFirstVideo({id:'d',brandId:'b',keyframeId:'k',preflightId:'pf',fingerprint:'f',confirmation:true}));
  assert.deepEqual(events,['boundary','provider-id']);assert.equal(outcome.status,'FAILED');assert.equal(outcome.boundaryState,'COMPLETED');assert.equal(outcome.providerRequestId,'provider-id');
 });
 await check('exact pilot preflight materializes frame bytes before certification and rejects missing evidence',async()=>{
  const {V210IntegratedProductionStarter}=require('../src/v2.10/integrated-starter');
  const starter=Object.create(V210IntegratedProductionStarter.prototype);starter.env={};let reads=0;
  const bytes=Buffer.from('synthetic frame'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const frame={id:'frame',version:1,content_hash:hash,storage_key:'frame.png',content_type:'image/png',validation_status:'PASS',approval_decision:'APPROVED',shot_id:'shot-1',production_id:'original'};
  const a=asset({model:'alibaba/wan-3',capability:'IMAGE_TO_VIDEO',v210_reference:{policy:'UPLOADED_REFERENCE',artifact:{artifactId:'frame',version:1,contentHash:hash,storageKey:'frame.png'}}});
  const draft={id:'draft',revision:1},canonical={input:{fingerprint:'canonical',workspaceId:'w',brandId:'b'}};
  starter.lockedFirstVideoProjection=()=>({canonical,asset:a,plan:{provider:'replicate',model:'alibaba/wan-3'}});
  let missing=false;
  starter.runtime=()=>({mediaExecutor:{selection:()=>({provider:'replicate',model:'alibaba/wan-3'}),materializeAsset:async()=>{
    reads++;if(missing)throw Object.assign(Error('missing bytes'),{code:'REFERENCE_EVIDENCE_MISSING'});
    return {...a,generation_requirements:{...a.generation_requirements,references:{first_frame:'data:image/png;base64,'+bytes.toString('base64')},v210_reference_evidence:{referenceWidth:90,referenceHeight:160,referenceAspectRatio:0.5625,expectedAspectRatio:'9:16',referenceHash:hash}}};
  }}});
  const result=await starter.preflightLockedFirstVideo({draft,keyframe:frame});assert.equal(reads,1);assert(result.asset.generation_requirements.provider_request_preflight.fingerprint);assert(result.plan.executionFingerprint);
  missing=true;await assert.rejects(()=>starter.preflightLockedFirstVideo({draft,keyframe:frame}),e=>e.code==='REFERENCE_EVIDENCE_MISSING');
 });
 await check('inline reference evidence is hashed rather than persisted as base64',()=>{
  const {redactInlineMedia}=require('../src/providers/request-evidence');const value={prompt:'A scene.',images:['data:image/png;base64,YQ==']};
  const result=redactInlineMedia(value);assert.equal(result.prompt,value.prompt);assert.equal(result.images[0].bytes,1);assert.equal(result.images[0].sha256,crypto.createHash('sha256').update('a').digest('hex'));assert.equal(typeof value.images[0],'string');assert(!JSON.stringify(result).includes('YQ=='));
 });
 console.log(`${groups} production-readiness groups PASS. Real provider calls: 0; database access: 0.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
