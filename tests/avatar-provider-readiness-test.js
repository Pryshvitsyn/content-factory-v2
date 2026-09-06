'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { AvatarProviderReadinessService } = require('../src/avatar-studio/avatar-provider-readiness-service');
const { ProviderMediaMaterializer } = require('../src/providers/provider-media-materializer');

const avatar={identityVersionId:'identity-current',subjectType:'PERSON',passportCertificationEvents:[{id:'passport-current',identityVersionId:'identity-current'}]};
const binding=(provider,extra={})=>({id:`${provider}-binding`,provider,status:'ACTIVE',bindingRevision:2,identityVersionId:'identity-current',passportCertificationId:'passport-current',providerBindingType:provider==='HEYGEN'?'HEYGEN_PHOTO_AVATAR_API':provider==='TAVUS'?'TAVUS_REPLICA_API':'DID_INSTANT_AVATAR_API',providerConsentEvidence:{provider},provisioningEvidence:{entitlementStatus:'VERIFIED'},...extra});
const prices={HEYGEN:{status:'KNOWN_CURRENT_PRICE',amountUsd:1,validUntil:'2030-01-01T00:00:00Z'},TAVUS:{status:'KNOWN_CURRENT_PRICE',amountUsd:2,validUntil:'2030-01-01T00:00:00Z'},DID:{status:'KNOWN_CURRENT_PRICE',amountUsd:3,validUntil:'2030-01-01T00:00:00Z'}};

test('readiness returns every independent blocker and never exposes a credential', () => {
  const service=new AvatarProviderReadinessService({adapters:{HEYGEN:{configured:()=>false,generate:async()=>{}}},now:()=>new Date('2029-01-01T00:00:00Z')});
  const result=service.provider({provider:'HEYGEN',avatar,binding:binding('HEYGEN',{status:'REVOKED',identityVersionId:'old',passportCertificationId:'old',providerConsentEvidence:null}),requestedEngine:'NOPE',provisioningMode:'PROVISION_NEW_PROVIDER_AVATAR'});
  assert.deepEqual(result.connection,{status:'NOT_CONFIGURED',check:'NOT_PERFORMED'});
  assert.deepEqual(result.blockers.map((item)=>item.code),['BLOCKED_CREDENTIAL_MISSING','BLOCKED_BINDING_INACTIVE','BLOCKED_IDENTITY_STALE','BLOCKED_PASSPORT_REQUIRED','BLOCKED_PROVIDER_CONSENT_REQUIRED','BLOCKED_PROVIDER_CAPABILITY','BLOCKED_PERFORMANCE_CAPTURE_REQUIRED','BLOCKED_EXTERNAL_AUDIO_REQUIRED','BLOCKED_PRICE_UNKNOWN']);
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.equal(result.providerCalls,0);
});
test('entitlement unknown is distinct from credentials and a pre-bound Twin needs no provisioning', () => {
  const service=new AvatarProviderReadinessService({adapters:{HEYGEN:{configured:()=>true,generate:async()=>{}}},now:()=>new Date('2029-01-01T00:00:00Z')});
  const result=service.provider({provider:'HEYGEN',avatar,binding:binding('HEYGEN',{providerBindingType:'HEYGEN_DIGITAL_TWIN_PREBOUND',provisioningEvidence:{}}),audioArtifact:{artifactId:'audio',artifactVersion:1,contentHash:'hash'},price:prices.HEYGEN});
  assert.equal(result.entitlement,'ENTITLEMENT_UNKNOWN');
  assert.equal(result.provisioning.sideEffects,false);
  assert.ok(result.blockers.some((item)=>item.code==='BLOCKED_MEDIA_MATERIALIZER_REQUIRED'));
  assert.ok(!result.blockers.some((item)=>item.code==='BLOCKED_PERFORMANCE_CAPTURE_REQUIRED'));
});
test('benchmark freezes fairness inputs, has no calls, and computes total only with current prices', () => {
  const service=new AvatarProviderReadinessService({adapters:{HEYGEN:{configured:()=>true,generate:async()=>{}},TAVUS:{configured:()=>true,generate:async()=>{}},DID:{configured:()=>true,generate:async()=>{}}},mediaMaterializer:{canMaterialize:()=>true,describe:()=>({status:'CONFIGURED'})},now:()=>new Date('2029-01-01T00:00:00Z')});
  const benchmarkBindings=['HEYGEN','TAVUS','DID'].map((provider)=>binding(provider,provider==='HEYGEN'?{}:{performanceCaptureId:`capture-${provider}`}));
  const result=service.benchmark({avatar:{...avatar,performanceCaptures:[{id:'capture-TAVUS',identityVersionId:'identity-current'},{id:'capture-DID',identityVersionId:'identity-current'}]},bindings:benchmarkBindings,prices,engines:{HEYGEN:'AVATAR_IV',TAVUS:'TAVUS_REPLICA',DID:'DID_SCENE'},audioArtifact:{artifactId:'audio',artifactVersion:1,contentHash:'hash'}});
  assert.equal(result.maximumTotalCostUsd,6); assert.equal(result.status,'READY'); assert.equal(result.childRouteMode,'INDEPENDENT_SEQUENTIAL_V1'); assert.equal(result.providerCalls,0);
});
test('materializer rejects an expired or unbounded transport', async () => {
  const materializer=new ProviderMediaMaterializer({publisher:{async publish(){return {url:'https://media.example/audio.mp3',expiresAt:'2030-01-01T00:00:00Z'};}}});
  const value=await materializer.materialize({provider:'TAVUS',purpose:'EXTERNAL_AUDIO',artifact:{artifactId:'audio',artifactVersion:2,contentHash:'hash'}});
  assert.equal(value.providerValueType,'HTTPS_URL'); assert.equal(value.sourceArtifactVersion,2);
  await assert.rejects(()=>new ProviderMediaMaterializer().materialize({}), (error)=>error.code==='BLOCKED_MEDIA_MATERIALIZER_REQUIRED');
  await assert.rejects(()=>new ProviderMediaMaterializer({publisher:{async publish(){return {url:'https://media.example/old.mp3',expiresAt:'2020-01-01T00:00:00Z'};}}}).materialize({provider:'DID',purpose:'EXTERNAL_AUDIO',artifact:{}}),/future bounded/);
});
