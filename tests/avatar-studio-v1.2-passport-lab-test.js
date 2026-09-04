'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { canonicalIdentityLock } = require('../src/avatar-studio/domain');
const { evaluateAvatarLevels } = require('../src/avatar-studio/level-engine');
const { compilePassportGenerationSpec } = require('../src/avatar-studio/passport-plan-compiler');
const { analyzePassportCandidate, panelRegions } = require('../src/avatar-studio/passport-qa');
const { PASSPORT_OUTPUT } = require('../src/avatar-studio/passport-contract');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { CAPABILITIES, normalizeCapability } = require('../src/v2.8/capabilities');

const BRAND='11111111-1111-4111-8111-111111111111';
const identity={ agePresentation:'late 30s',personality:'calm',role:'expert',languages:['en'],visualDirection:'natural',
  permanentAttributes:{},prohibitedUses:['deception'] };
function avatar(overrides={}) { return { id:'avatar-1',workspaceId:'workspace-1',internalName:'Mara',subjectType:'SYNTHETIC',
  vertical:'PSYCHOLOGY_WELLBEING',identityVersionId:'identity-v2',version:2,identity,brandIds:[BRAND],
  brandPermissions:[{brandId:BRAND,allowed:true}],consent:{status:'APPROVED'},consentRecords:[{status:'APPROVED'}],consentEvents:[],
  sources:[],identityLocks:[{id:'lock-v1',identityVersionId:'identity-v2'}],passportCertificationEvents:[],passports:[],
  passportCandidates:[],bodyReferences:[],expressionReferences:[],wardrobes:[],voiceProfiles:[],locations:[],performancePacks:[],
  continuityReadiness:[],...overrides }; }

const lock=canonicalIdentityLock({ permanent:{ facialStructure:'preserve',nose:'preserve',jaw:'preserve',apparentAge:'preserve' },
  temporary:{ hat:'exclude',jacket:'exclude',wardrobe:'exclude',background:'exclude' },uncertain:{ glasses:'human decision' } });
assert.equal(lock.schemaVersion,'avatar-identity-lock-v1');
for (const forbidden of ['hat','jacket','wardrobe','background','environment','location']) assert.throws(
  ()=>canonicalIdentityLock({permanent:{facialStructure:'preserve',[forbidden]:'permanent'}}),
  (error)=>error.code==='IDENTITY_LOCK_TEMPORARY_AS_PERMANENT' && error.details.forbidden.includes(forbidden));
assert.throws(()=>canonicalIdentityLock({permanent:{nose:'x'},temporary:{nose:'y'}}),
  (error)=>error.code==='IDENTITY_LOCK_CLASSIFICATION_CONFLICT');

const noCertificate=evaluateAvatarLevels(avatar());
assert.equal(noCertificate.currentLevel,0); assert.deepEqual(noCertificate.nextLevel,{level:1,name:'PASSPORT'});
assert(noCertificate.missingRequirements.includes('CERTIFIED_PASSPORT_REQUIRED'));
const qaOnly=evaluateAvatarLevels(avatar({passportCandidates:[{qaStatus:'PASS_FOR_REVIEW'}]}));
assert.equal(qaOnly.currentLevel,0,'automated QA must not create L1');
const kept=evaluateAvatarLevels(avatar({passportCandidates:[{humanReviewState:'KEPT'}]}));
assert.equal(kept.currentLevel,0,'KEEP must not create L1');
const certified=evaluateAvatarLevels(avatar({passportCertificationEvents:[{identityVersionId:'identity-v2',identityLockVersionId:'lock-v1',explicitConfirmation:true}]}));
assert.equal(certified.currentLevel,1); assert.deepEqual(certified.nextLevel,{level:2,name:'BODY_EXPRESSIONS'});
const legacyCertified=evaluateAvatarLevels(avatar({identityLocks:[],passportCertificationEvents:[],
  passports:[{decision:'CERTIFIED',panels:[{angle:'FRONTAL'},{angle:'THREE_QUARTER_45'},{angle:'PROFILE_90'}]}]}));
assert.equal(legacyCertified.currentLevel,1,'upgraded immutable V1 certification remains valid without silent recertification');
const newIdentity=evaluateAvatarLevels(avatar({identityVersionId:'identity-v3',version:3,
  identityLocks:[{id:'lock-v2',identityVersionId:'identity-v3'}],passportCertificationEvents:[{identityVersionId:'identity-v2'}]}));
assert.equal(newIdentity.currentLevel,0,'a new Identity Version requires its own human-certified passport');
const newLock=evaluateAvatarLevels(avatar({identityLocks:[{id:'lock-v2',identityVersionId:'identity-v2'}],
  passportCertificationEvents:[{identityVersionId:'identity-v2',identityLockVersionId:'lock-v1'}]}));
assert.equal(newLock.currentLevel,0,'a new Identity Lock version requires a new human-certified passport');

const canonicalV1=avatar({subjectType:'CONSENTED_REAL_PERSON',identity:{agePresentation:'DECLARED_BY_OPERATOR',personality:'TO_BE_DEFINED',
  role:'Creator',languages:['und'],visualDirection:'TO_BE_DEFINED',permanentAttributes:{},prohibitedUses:['unconsented use']},
  provenance:{ageClass:'ADULT'},consent:{status:'APPROVED'},consentRecords:[{status:'APPROVED',scope:'FACE'}],
  sources:[{roles:['IDENTITY'],effectiveGate0Status:'PASS'}],identityIntakeConfirmations:[{identityVersionId:'identity-v2'}]});
const canonicalV1L0=evaluateAvatarLevels(canonicalV1);
assert.equal(canonicalV1L0.currentLevel,0); assert.deepEqual(canonicalV1L0.nextLevel,{level:1,name:'PASSPORT'});
assert(!canonicalV1L0.levels[0].missing.includes('IDENTITY_PERSONALITY_ROLE'));
assert(!canonicalV1L0.levels[0].missing.includes('IDENTITY_LANGUAGES'));
assert(!canonicalV1L0.levels[0].missing.includes('IDENTITY_VISUAL_DIRECTION'));
const canonicalV1L1=evaluateAvatarLevels({...canonicalV1,passportCertificationEvents:[{identityVersionId:'identity-v2',identityLockVersionId:'lock-v1',explicitConfirmation:true}]});
assert.equal(canonicalV1L1.currentLevel,1); assert.deepEqual(canonicalV1L1.nextLevel,{level:2,name:'BODY_EXPRESSIONS'});
for (const unsafe of [
  {...canonicalV1,consent:{status:'REVIEW'},consentRecords:[{status:'REVIEW'}]},
  {...canonicalV1,identityLocks:[]},
  {...canonicalV1,sources:[{roles:['IDENTITY'],effectiveGate0Status:'BLOCK'}]},
]) assert.equal(evaluateAvatarLevels(unsafe).nextLevel.level,0,'canonical V1 safety requirements fail closed');

const catalog=new ProviderCatalog({env:{OPENAI_API_KEY:'configured-for-local-catalog-test'}});
assert.equal(normalizeCapability('MULTI_VIEW_IDENTITY_REFERENCE'),CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE);
const model=catalog.listModels('openai').find((item)=>item.modelId==='gpt-image-1');
assert(model.capabilities.includes(CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE));
const plan=compilePassportGenerationSpec({avatar:avatar(),identityVersion:{id:'identity-v2'},identityLock:{id:'lock-v1',
  identityVersionId:'identity-v2',permanentAttributes:lock.permanent,temporaryAttributes:lock.temporary,uncertainAttributes:lock.uncertain},
  sourceAssets:[{id:'source-1',brandId:BRAND}],requestedCandidateCount:4,
  preferred:{provider:'openai',model:'gpt-image-1'},providerCatalog:catalog});
assert.equal(plan.requestedCandidateCount,4); assert.equal(plan.plannedExternalCallCount,4);
assert.equal(plan.externalGenerationCalls??plan.executedExternalGenerationCalls,0); assert.equal(plan.paidProviderCalls,0);
assert.equal(plan.executionAuthorized,false); assert.equal(plan.costPlan.status,'UNKNOWN');
assert.equal(plan.costPlan.knownTotalCost,null); assert(plan.costPlan.unknownElements.includes('TOTAL_COST'));
assert.deepEqual(plan.requiredViews.map((item)=>item.view),['FRONTAL','THREE_QUARTER_45','PROFILE_90']);
assert.equal(plan.promptAssets.length,3); assert(plan.providerCapabilityRequirements.includes(CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE));
const repair=compilePassportGenerationSpec({avatar:avatar(),identityVersion:{id:'identity-v2'},identityLock:{id:'lock-v1',
  identityVersionId:'identity-v2',permanentAttributes:lock.permanent,temporaryAttributes:lock.temporary,uncertainAttributes:lock.uncertain},
  sourceAssets:[{id:'source-1',brandId:BRAND}],originalGenerationSpecId:'plan-1',repairDelta:{profile:'preserve original nose'}});
assert.equal(repair.originalGenerationSpecId,'plan-1'); assert.equal(repair.promptAssets.length,4);

assert.deepEqual(panelRegions(3000,1000).map((item)=>[item.view,item.x,item.width]),[
  ['FRONTAL',0,1000],['THREE_QUARTER_45',1000,1000],['PROFILE_90',2000,1000]]);
const local=analyzePassportCandidate({width:3000,height:1000});
assert.equal(local.status,'WARN'); assert.equal(local.panelRegions.length,3); assert.equal(local.engine,'V2.10_CONTINUITY_CONTRACT');
assert.equal(local.reasoning.geometryContract,'V2.10.2_REFERENCE_GEOMETRY'); assert.equal(local.samePersonConfidence,null);
const canonicalGeometry=analyzePassportCandidate({width:PASSPORT_OUTPUT.width,height:PASSPORT_OUTPUT.height});
assert(!canonicalGeometry.warnings.includes('PASSPORT_PANEL_GEOMETRY_UNUSUAL'),
  'canonical 1536x1024 three-panel output must satisfy its own QA geometry contract');
const malformedGeometry=analyzePassportCandidate({width:1536,height:1536});
assert(malformedGeometry.warnings.includes('PASSPORT_PANEL_GEOMETRY_UNUSUAL'));
assert(malformedGeometry.blockingFailures.includes('PASSPORT_NOT_HORIZONTAL'));
const scored=analyzePassportCandidate({width:3000,height:1000,observations:{SOURCE_SIMILARITY:.93,FRONTAL_IDENTITY:.94,
  THREE_QUARTER_IDENTITY:.91,PROFILE_IDENTITY:.9,CROSS_PANEL_IDENTITY:.92}});
assert(scored.samePersonConfidence>.9); assert.notEqual(scored.status,'REJECT');
const drift=analyzePassportCandidate({width:3000,height:1000,profileDrift:true,observations:{PROFILE_IDENTITY:'FAIL'}});
assert.equal(drift.status,'REJECT'); assert(drift.blockingFailures.includes('PROFILE_DRIFT'));

for (const prompt of ['AVATAR_PASSPORT_BASE','AVATAR_PASSPORT_IDENTITY_LOCK','AVATAR_PASSPORT_NEGATIVE','AVATAR_PASSPORT_REPAIR']) {
  const asset=JSON.parse(fs.readFileSync(require.resolve(`../src/avatar-studio/prompts/${prompt}.v1.json`),'utf8'));
  assert.equal(asset.id,prompt); assert.match(asset.version,/^1\./);
}
const sql=fs.readFileSync(require.resolve('../migrations/20260901_avatar_studio_v1_2_passport_lab.sql'),'utf8');
for(const table of ['identity_lock_versions','passport_generation_specs','passport_candidates','passport_qa_snapshots',
  'passport_candidate_review_events','passport_certification_events']) assert(sql.includes(`avatar_studio.${table}`));
assert.match(sql,/uq_avatar_passport_certified_identity_version/); assert.match(sql,/CERTIFIED_PASSPORT_REQUIRED/);
assert.match(sql,/execution_authorized = false/); assert.match(sql,/reject_immutable_change/);

console.log('Avatar Studio V1.2 Identity Lock, strict L0/L1, plan-only prompts/catalog, Passport QA and repair contracts passed; paid provider calls = 0; external generation calls = 0');
