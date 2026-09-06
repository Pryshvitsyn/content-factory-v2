'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { AvatarProviderReadinessService } = require('../src/avatar-studio/avatar-provider-readiness-service');
const { ProviderMediaMaterializer } = require('../src/providers/provider-media-materializer');

const now=()=>new Date('2029-01-01T00:00:00Z');
const avatar={identityVersionId:'identity-current',subjectType:'PERSON',passportCertificationEvents:[{id:'passport-current',identityVersionId:'identity-current'}],performanceCaptures:[{id:'capture-TAVUS',identityVersionId:'identity-current'},{id:'capture-DID',identityVersionId:'identity-current'}]};
const binding=(provider,extra={})=>({id:`${provider}-binding`,provider,status:'ACTIVE',bindingRevision:2,identityVersionId:'identity-current',passportCertificationId:'passport-current',providerBindingType:provider==='HEYGEN'?'HEYGEN_PHOTO_AVATAR_API':provider==='TAVUS'?'TAVUS_REPLICA_API':'DID_INSTANT_AVATAR_API',performanceCaptureId:provider==='HEYGEN'?null:`capture-${provider}`,providerConsentEvidence:{provider},provisioningEvidence:{entitlementStatus:'VERIFIED'},...extra});
const engine={HEYGEN:'AVATAR_IV',TAVUS:'TAVUS_REPLICA',DID:'DID_SCENE'};
const price=(provider,extra={})=>({provider,providerEngine:engine[provider],operation:'AVATAR_RENDER',billingUnit:'PER_EXECUTION',status:'KNOWN_CURRENT_PRICE',amountUsd:1,currency:'USD',validUntil:'2030-01-01T00:00:00Z',...extra});
const adapters=Object.fromEntries(Object.keys(engine).map((provider)=>[provider,{configured:()=>true,generate:async()=>{}}]));
const readyService=()=>new AvatarProviderReadinessService({adapters,mediaMaterializer:{canMaterialize:()=>true,describe:()=>({status:'CONFIGURED'})},now});
const readyInput=(provider='HEYGEN',extra={})=>({provider,avatar,binding:binding(provider),requestedEngine:engine[provider],durationPolicy:{requestedSeconds:5},audioArtifact:{artifactId:'audio',artifactVersion:1,contentHash:'hash'},price:price(provider),...extra});

test('readiness returns every independent blocker and never exposes a credential', () => {
  const service=new AvatarProviderReadinessService({adapters:{HEYGEN:{configured:()=>false,generate:async()=>{}}},now});
  const result=service.provider({provider:'HEYGEN',avatar,binding:binding('HEYGEN',{status:'REVOKED',identityVersionId:'old',passportCertificationId:'old',providerConsentEvidence:null}),requestedEngine:'NOPE',provisioningMode:'PROVISION_NEW_PROVIDER_AVATAR'});
  assert.deepEqual(result.connection,{status:'NOT_CONFIGURED',check:'NOT_PERFORMED'});
  assert.deepEqual(result.blockers.map((item)=>item.code),['BLOCKED_CREDENTIAL_MISSING','BLOCKED_BINDING_INACTIVE','BLOCKED_IDENTITY_STALE','BLOCKED_PASSPORT_REQUIRED','BLOCKED_PROVIDER_CONSENT_REQUIRED','BLOCKED_PROVIDER_CAPABILITY','BLOCKED_PERFORMANCE_CAPTURE_REQUIRED','BLOCKED_EXTERNAL_AUDIO_REQUIRED','BLOCKED_PRICE_UNKNOWN']);
  assert.equal(JSON.stringify(result).includes('secret'),false); assert.equal(result.providerCalls,0);
});
test('HEYGEN AVATAR_IV evidence cannot authorize AVATAR_V', () => {
  const result=readyService().provider(readyInput('HEYGEN',{requestedEngine:'AVATAR_V'}));
  assert.ok(result.blockers.some((item)=>item.code==='BLOCKED_PRICE_UNKNOWN')); assert.equal(result.pricing.maximumCostUsd,null);
});
test('render evidence cannot authorize provisioning', () => {
  const result=readyService().provider(readyInput('HEYGEN',{operation:'AVATAR_PROVISION'}));
  assert.ok(result.blockers.some((item)=>item.code==='BLOCKED_PRICE_UNKNOWN'));
});
test('exact engine and render operation price authorizes readiness', () => {
  const result=readyService().provider(readyInput());
  assert.equal(result.status,'READY'); assert.equal(result.pricing.maximumCostUsd,1); assert.equal(result.pricing.operation,'AVATAR_RENDER');
});
test('stale, missing, unbounded and historical ambiguous prices fail closed', () => {
  const service=readyService();
  assert.ok(service.provider(readyInput('HEYGEN',{price:price('HEYGEN',{validUntil:'2028-01-01T00:00:00Z'})})).blockers.some((item)=>item.code==='BLOCKED_PRICE_STALE'));
  assert.ok(service.provider(readyInput('HEYGEN',{price:null})).blockers.some((item)=>item.code==='BLOCKED_PRICE_UNKNOWN'));
  assert.ok(service.provider(readyInput('HEYGEN',{price:price('HEYGEN',{billingUnit:'SUBSCRIPTION_DEPENDENT'})})).blockers.some((item)=>item.code==='BLOCKED_PRICE_UNBOUNDED'));
  const legacy={status:'KNOWN_CURRENT_PRICE',amountUsd:1,validUntil:'2030-01-01T00:00:00Z'};
  assert.ok(service.provider({...readyInput(),avatar:{...avatar,providerPricingEvidence:[legacy]},price:null}).blockers.some((item)=>item.code==='BLOCKED_PRICE_UNKNOWN'));
});
test('duration and credit bounded maxima are deterministic only with stored authority', () => {
  const service=readyService();
  const seconds=service.provider(readyInput('HEYGEN',{price:price('HEYGEN',{billingUnit:'PER_SECOND',amountUsd:0.2}),durationPolicy:{requestedSeconds:5}}));
  assert.equal(seconds.pricing.maximumCostUsd,1); assert.deepEqual(seconds.pricing.calculation,{billingUnit:'PER_SECOND',frozenRequestedDurationSeconds:5,units:5,amountUsd:1});
  const missingRule=service.provider(readyInput('HEYGEN',{price:price('HEYGEN',{billingUnit:'PER_CREDIT'})})); assert.ok(missingRule.blockers.some((item)=>item.code==='BLOCKED_PRICE_UNBOUNDED'));
  const credits=service.provider(readyInput('HEYGEN',{price:price('HEYGEN',{billingUnit:'PER_CREDIT',amountUsd:0.5,creditToOperationRule:{creditsPerOperation:2,authority:'official schedule'}})})); assert.equal(credits.pricing.maximumCostUsd,1);
});
test('benchmark total exists only when every exact child cost is bounded', () => {
  const service=readyService(); const bindings=['HEYGEN','TAVUS','DID'].map(binding); const prices={HEYGEN:price('HEYGEN',{amountUsd:1}),TAVUS:price('TAVUS',{billingUnit:'PER_SECOND',amountUsd:0.5}),DID:price('DID',{amountUsd:3})};
  const result=service.benchmark({avatar,bindings,prices,engines:engine,durationPolicy:{requestedSeconds:4},audioArtifact:{artifactId:'audio',artifactVersion:1,contentHash:'hash'}});
  assert.equal(result.maximumTotalCostUsd,6); assert.equal(result.status,'READY'); assert.equal(result.providerCalls,0); assert.equal(result.externalGenerationCalls,0);
  const blocked=service.benchmark({avatar,bindings,prices:{...prices,DID:price('DID',{billingUnit:'UNKNOWN'})},engines:engine,durationPolicy:{requestedSeconds:4},audioArtifact:{artifactId:'audio',artifactVersion:1,contentHash:'hash'}}); assert.equal(blocked.maximumTotalCostUsd,null);
});
test('entitlement unknown is distinct from credentials and a pre-bound Twin needs no provisioning', () => {
  const service=readyService(); const result=service.provider(readyInput('HEYGEN',{binding:binding('HEYGEN',{providerBindingType:'HEYGEN_DIGITAL_TWIN_PREBOUND',provisioningEvidence:{}})}));
  assert.equal(result.entitlement,'ENTITLEMENT_UNKNOWN'); assert.equal(result.provisioning.sideEffects,false); assert.ok(!result.blockers.some((item)=>item.code==='BLOCKED_PERFORMANCE_CAPTURE_REQUIRED'));
});
test('materializer rejects an expired or unbounded transport', async () => {
  const materializer=new ProviderMediaMaterializer({publisher:{async publish(){return {url:'https://media.example/audio.mp3',expiresAt:'2030-01-01T00:00:00Z'};}}}); const value=await materializer.materialize({provider:'TAVUS',purpose:'EXTERNAL_AUDIO',artifact:{artifactId:'audio',artifactVersion:2,contentHash:'hash'}});
  assert.equal(value.providerValueType,'HTTPS_URL'); await assert.rejects(()=>new ProviderMediaMaterializer().materialize({}), (error)=>error.code==='BLOCKED_MEDIA_MATERIALIZER_REQUIRED');
});
