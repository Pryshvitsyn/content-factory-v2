'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalPerformanceCapture, canonicalProviderBinding, canonicalPerformanceContract, impulseOffCalmSelfContract, IMPULSEOFF_CALM_SELF_V1, AvatarPerformanceRuntimeService, AVATAR_PROVIDER_CAPABILITIES } = require('../src/avatar-studio/avatar-performance-runtime');
const { HeyGenAvatarAdapter } = require('../src/providers/heygen-avatar-adapter');
const { TavusAvatarAdapter } = require('../src/providers/tavus-avatar-adapter');
const { DidAvatarAdapter } = require('../src/providers/did-avatar-adapter');

const ids = { workspaceId:'workspace-a', brandId:'brand-a', avatarId:'avatar-a', identityVersionId:'identity-v1', passportCertificationId:'passport-v1' };
function capture() { return canonicalPerformanceCapture({ ...ids, artifactId:'capture', artifactVersion:1, contentHash:'capture-hash', durationMs:61000, width:1920, height:1080, codec:'h264', fps:30, humanApproved:true, provenance:{ source:'approved-camera' } }); }
function binding(provider='HEYGEN', extra={}) { const config={ HEYGEN:{ type:'HEYGEN_PHOTO_AVATAR_API', engine:'AVATAR_IV' }, TAVUS:{ type:'TAVUS_REPLICA_API', engine:'TAVUS_REPLICA' }, DID:{ type:'DID_INSTANT_AVATAR_API', engine:'DID_SCENE' } }[provider]; return canonicalProviderBinding({ ...ids, provider, providerBindingType:config.type, providerExternalId:`${provider.toLowerCase()}-id`, providerEngineCapabilities:[config.engine], performanceCapture: config.type==='HEYGEN_PHOTO_AVATAR_API'?null:{ id:'capture-1' }, providerConsentEvidence: provider==='HEYGEN'?null:{ provider, artifactId:`${provider}-consent`, artifactVersion:1, contentHash:`${provider}-consent-hash`, consentType:'VIDEO_CONSENT' }, entitlementVerified:true, ...extra }); }
function persistedBinding(provider='HEYGEN') { const value=binding(provider); return { ...value, id:`binding-${provider}`, status:'ACTIVE' }; }
function request(provider='HEYGEN', extra={}) { const engine={HEYGEN:'AVATAR_IV',TAVUS:'TAVUS_REPLICA',DID:'DID_SCENE'}[provider]; return { ...ids, provider, providerBinding:persistedBinding(provider), providerEngine:engine, performanceProfile:'IMPULSEOFF_CALM_SELF_V1', script:'Take one calm breath.', audioStrategy:'EXTERNAL_AUDIO', audioArtifact:{artifactId:'voice-1',artifactVersion:3,contentHash:'voice-hash'}, language:'en', framing:'CHEST_UP', aspectRatio:'9:16', durationPolicy:{requestedSeconds:5}, expressionTarget:'CALM_ATTENTIVE', gestureIntensity:'MINIMAL', cameraPolicy:'LOCKED_OR_NEARLY_LOCKED', backgroundPolicy:'APPROVED_NEUTRAL', outputFormat:'MP4', qaProfile:'AVATAR_PERFORMANCE_V1', ...extra }; }

test('Performance Capture is immutable source evidence, not Identity Truth', () => {
  const value=capture(); assert.equal(value.technicalEvidence.durationMs,61000); assert.ok(value.fingerprint); assert.throws(() => canonicalPerformanceCapture({ ...ids, artifactId:'x',artifactVersion:1,contentHash:'x',durationMs:1,width:1,height:1,codec:'h264',fps:30,humanApproved:false }), /human approval/);
});
test('binding is explicit, versioned and provider-specific consent is never shared', () => {
  assert.equal(binding('HEYGEN').provider,'HEYGEN'); assert.equal(binding('TAVUS').providerConsentEvidence.provider,'TAVUS');
  assert.throws(() => canonicalProviderBinding({ ...ids,provider:'HEYGEN',providerBindingType:'HEYGEN_DIGITAL_TWIN_API',providerExternalId:'x',performanceCapture:{id:'capture'},providerEngineCapabilities:['AVATAR_V'] }), (error) => error.code==='PROVIDER_ENTITLEMENT_REQUIRED');
  assert.throws(() => canonicalProviderBinding({ ...ids,provider:'TAVUS',providerBindingType:'TAVUS_REPLICA_API',providerExternalId:'x',providerEngineCapabilities:[] }), (error) => error.code==='PERFORMANCE_CAPTURE_REQUIRED');
});
test('performance route rejects AUTO, absent audio ownership and provider substitution', () => {
  assert.throws(() => canonicalPerformanceContract(request('HEYGEN',{providerEngine:'AUTO'})), (error) => error.code==='AVATAR_EXPLICIT_ROUTE_REQUIRED');
  assert.throws(() => canonicalPerformanceContract(request('HEYGEN',{audioArtifact:null})), (error) => error.code==='EXTERNAL_AUDIO_ARTIFACT_REQUIRED');
  assert.throws(() => canonicalPerformanceContract(request('HEYGEN',{providerBinding:persistedBinding('TAVUS')})), (error) => error.code==='AVATAR_PROVIDER_BINDING_REQUIRED');
  const route=canonicalPerformanceContract(request()); assert.equal(route.provider,'HEYGEN'); assert.equal(route.audioStrategy,'EXTERNAL_AUDIO'); assert.ok(route.requestFingerprint);
});
test('ImpulseOff Calm Self freezes the short calm 9:16 contract and has no phrase authority', () => {
  const route=impulseOffCalmSelfContract(request('HEYGEN',{durationSeconds:5})); assert.equal(route.performanceProfile,IMPULSEOFF_CALM_SELF_V1.id); assert.equal(route.aspectRatio,'9:16'); assert.equal(IMPULSEOFF_CALM_SELF_V1.delivery,'PRE_RENDERED_CERTIFIED_CLIP_PACK_ONLY'); assert.throws(() => impulseOffCalmSelfContract(request('HEYGEN',{durationSeconds:11})), (error)=>error.code==='IMPULSEOFF_DURATION_INVALID');
});

function repo() {
  const state={events:[],attempts:[],executions:[],benchmarks:[]}; return { state,
    async avatarProviderBinding({id}) { return Object.values(state.bindings||{}).find((item)=>item.id===id)||null; },
    async createAvatarPerformanceExecution({preflight}) { const row={id:`execution-${state.executions.length+1}`,preflightSnapshot:preflight,preflightFingerprint:preflight.preflightFingerprint,requestFingerprint:preflight.contract.requestFingerprint,binding:await this.avatarProviderBinding({id:preflight.contract.providerBindingId}),attempts:[],approval:null}; state.executions.push(row); return row; },
    async avatarPerformanceExecution({id}) { return state.executions.find((item)=>item.id===id)||null; },
    async approveAvatarPerformanceExecution({execution}) { execution.approval={id:'approval-1'}; return execution.approval; },
    async createAvatarPerformanceAttempt({execution}) { const row={id:`attempt-${state.attempts.length+1}`,executionId:execution.id,idempotencyKey:`avatar-performance:${execution.id}`}; state.attempts.push(row); execution.attempts.push(row); return row; },
    async recordAvatarPerformanceAttemptEvent(event) { state.events.push(event); if(event.providerRequestId) event.attempt.providerRequestId=event.providerRequestId; return event; },
    async completeAvatarPerformanceAttempt({attempt}) { return {id:`result-${attempt.id}`,attemptId:attempt.id}; },
    async createAvatarProviderBenchmark({benchmark}) { state.benchmarks.push(benchmark); return benchmark; },
  };
}
test('preflight is zero-call, price fail-closed, and disabled execution never crosses provider boundary', async () => {
  const store=repo(); store.state.bindings={ 'binding-HEYGEN':persistedBinding('HEYGEN') }; const service=new AvatarPerformanceRuntimeService({repository:store,env:{LIVE_PAID_GENERATION:'false'}});
  const blocked=await service.preflight({...request(),providerBindingId:'binding-HEYGEN',price:{status:'UNKNOWN_CURRENT_PRICE'}}); assert.equal(blocked.readiness,'BLOCKED'); assert.equal(blocked.providerCalls,0);
  const ready=await service.preflight({...request(),providerBindingId:'binding-HEYGEN',price:{status:'KNOWN_CURRENT_PRICE',amountUsd:1}}); const execution=await service.createExecution({preflight:ready}); await service.approve({executionId:execution.id,explicitConfirmation:true});
  await assert.rejects(()=>service.generate({executionId:execution.id,avatar:{}}),(error)=>error.code==='AVATAR_PERFORMANCE_LIVE_EXECUTION_DISABLED'); assert.equal(store.state.events.length,0);
});
test('provider request intent, boundary, request id and raw output are persisted in order', async () => {
  const store=repo(); store.state.bindings={ 'binding-HEYGEN':persistedBinding('HEYGEN') }; const artifactService={async createVersion(){return {artifactId:'raw-1',version:1};}};
  const assetIntakeService={async ingestProviderVideoOutput(){return {asset:{id:'intake-1'},artifact:{artifactId:'canonical-1',version:1}};}};
  const adapter={async materializeAudio(){return {providerUrl:'https://temporary.example/audio.mp3'};},async generate({idempotencyKey,onProviderRequest}){assert.equal(idempotencyKey,'avatar-performance:execution-1');await onProviderRequest({requestId:'heygen-job-1'});return {requestId:'heygen-job-1',output:Buffer.from('mp4')};}};
  const service=new AvatarPerformanceRuntimeService({repository:store,adapters:{HEYGEN:adapter},artifactService,assetIntakeService,env:{LIVE_PAID_GENERATION:'true'}});
  const preflight=await service.preflight({...request(),providerBindingId:'binding-HEYGEN',price:{status:'KNOWN_CURRENT_PRICE'}}); const execution=await service.createExecution({preflight}); await service.approve({executionId:execution.id,explicitConfirmation:true}); const output=await service.generate({executionId:execution.id,avatar:{}});
  assert.equal(output.providerCalls,1); assert.deepEqual(store.state.events.map((item)=>item.status),['PROVIDER_INTENT_PERSISTED','MAY_HAVE_STARTED','SUBMITTED','PROVIDER_OUTPUT_CHECKPOINTED','SUCCEEDED']);
});
test('provider adapters expose only modern configured routes and make no calls in construction', async () => {
  const calls=[]; const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:{video_id:'h-1'}}),headers:{get:()=>null}};};
  const heygen=new HeyGenAvatarAdapter({apiKey:'secret',fetchImpl}); await heygen.generate({contract:canonicalPerformanceContract(request()),binding:persistedBinding(),idempotencyKey:'idem'}); assert.match(calls[0].url,/\/v3\/videos$/); assert.doesNotMatch(calls[0].url,/\/v[12]\//); assert.equal(calls[0].options.headers['idempotency-key'],'idem');
  assert.equal(AVATAR_PROVIDER_CAPABILITIES.HEYGEN.apiVersion,'V3'); assert.equal(typeof new TavusAvatarAdapter({fetchImpl}).generate,'function'); assert.equal(typeof new DidAvatarAdapter({fetchImpl}).recover,'function');
});
test('benchmark freezes common intent but records provider-specific engines and deviations', async () => {
  const store=repo(); store.state.bindings={ 'binding-HEYGEN':persistedBinding('HEYGEN'),'binding-TAVUS':persistedBinding('TAVUS'),'binding-DID':persistedBinding('DID')}; const service=new AvatarPerformanceRuntimeService({repository:store});
  const common={...request(),providerEngines:{HEYGEN:'AVATAR_IV',TAVUS:'TAVUS_REPLICA',DID:'DID_SCENE'}}; const result=await service.benchmark({...ids,commonIntent:common,bindings:[store.state.bindings['binding-HEYGEN'],{...store.state.bindings['binding-TAVUS'],capabilityDeviation:{note:'training-specific'}},store.state.bindings['binding-DID']],priceByProvider:{HEYGEN:{status:'KNOWN_CURRENT_PRICE'},TAVUS:{status:'KNOWN_CURRENT_PRICE'},DID:{status:'ENTITLEMENT_REQUIRED'}}});
  assert.equal(result.executions.length,3); assert.equal(result.executions[2].preflight.readiness,'BLOCKED'); assert.equal(result.providerCalls,0);
});
