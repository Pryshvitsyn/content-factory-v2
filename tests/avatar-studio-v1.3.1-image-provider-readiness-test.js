'use strict';

const assert = require('node:assert/strict');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { CAPABILITIES } = require('../src/v2.8/capabilities');
const { compilePassportGenerationSpec } = require('../src/avatar-studio/passport-plan-compiler');
const { compilePassportProviderRequest } = require('../src/avatar-studio/passport-provider-compiler');
const { canonicalL2GenerationSpec } = require('../src/avatar-studio/l2-domain');
const { PassportExecutionService } = require('../src/avatar-studio/passport-execution-service');
const { buildSmokeReadiness } = require('../src/avatar-studio/smoke-readiness');
const { createOpenAIMediaProvider, DEFAULT_IMAGE_MODEL } = require('../src/providers/openai-media-provider');
const { estimateOpenAIImagePlan, actualOpenAIImageCost, imageTokenRates } = require('../src/v2.9.2/pricing-registry');

const WORKSPACE='11111111-1111-4111-8111-111111111111',BRAND='22222222-2222-4222-8222-222222222222';
const source={id:'source-1',brandId:BRAND,characterId:'avatar-1',intakeAssetId:'intake-1',gate0Status:'PASS',roles:['IDENTITY','PASSPORT_SOURCE']};
const intake={id:'intake-1',brandId:BRAND,characterId:'avatar-1',effectiveGate0Status:'PASS',contentHash:'source-hash',artifactId:'source-artifact',artifactVersion:1};
const lock={id:'lock-1',identityVersionId:'identity-1',permanentAttributes:{facialStructure:'preserve',nose:'preserve',jaw:'preserve'},
  temporaryAttributes:{wardrobe:'exclude',hat:'exclude'},uncertainAttributes:{glasses:'operator decision'}};
const avatar={id:'avatar-1',workspaceId:WORKSPACE,vertical:'TRAVEL',verticalCode:'TRAVEL',identityVersionId:'identity-1',subjectType:'SYNTHETIC',
  identityLocks:[lock],consentEvents:[],consentRecords:[],passportCertificationEvents:[],passportCandidates:[]};

async function main(){
  assert.equal(process.env.PAID_PROVIDER_CALLS,'0');assert.equal(process.env.EXTERNAL_GENERATION_CALLS,'0');
  const catalog=new ProviderCatalog({env:{OPENAI_API_KEY:'configured-but-never-used'}});
  const current=catalog.preferredModel({provider:'openai',capability:CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE,profile:'PREMIUM'});
  assert.equal(current.modelId,'gpt-image-2');assert.equal(current.lifecycleStatus,'CURRENT');assert.equal(current.selectable,true);
  const legacy=catalog.listModels('openai').find((item)=>item.modelId==='gpt-image-1');
  assert.equal(legacy.lifecycleStatus,'DEPRECATED');assert.equal(legacy.selectable,false);assert.equal(legacy.replacementModelId,'gpt-image-2');
  assert.equal(catalog.resolveSelection({provider:'openai',model:'gpt-image-1',profile:'PREMIUM',
    capability:'MULTI_VIEW_IDENTITY_REFERENCE'}).model,'gpt-image-1','historical provenance remains exactly resolvable');
  for(const capability of [CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE,CAPABILITIES.CHARACTER_BODY_REFERENCE,
    CAPABILITIES.CHARACTER_EXPRESSION_REFERENCE,CAPABILITIES.MOUTH_SHAPE_REFERENCE])assert(current.capabilities.includes(capability));

  const plan=compilePassportGenerationSpec({avatar,identityVersion:{id:'identity-1'},identityLock:lock,sourceAssets:[source],
    requestedCandidateCount:4,providerCatalog:catalog});
  assert.equal(plan.preferredModel,'gpt-image-2');assert.equal(plan.providerPlan.modelStatus,'CURRENT');assert.equal(plan.costPlan.status,'PARTIAL');
  assert.equal(plan.costPlan.knownSubtotalCost,0);assert.equal(plan.costPlan.estimatedOutputCost,0.66);
  assert.equal(plan.costPlan.knownTotalCost,null);assert.equal(plan.costPlan.unknownIsZero,false);
  assert.equal(plan.plannedExternalCallCount,4);assert.match(plan.providerPlan.reliability,/QA_AND_HUMAN_CERTIFICATION/);
  const legacyPlan=compilePassportGenerationSpec({avatar,identityVersion:{id:'identity-1'},identityLock:lock,sourceAssets:[source],
    requestedCandidateCount:3,providerCatalog:catalog,preferred:{provider:'openai',model:'gpt-image-1'}});
  assert.equal(legacyPlan.preferredModel,'gpt-image-1');assert.equal(legacyPlan.providerPlan.modelStatus,'DEPRECATED');
  const request=compilePassportProviderRequest({generationSpec:{...plan,id:'plan-1'},sourceImages:[{bytes:Buffer.from('source'),
    filename:'source.jpg',contentType:'image/jpeg'}],candidateOrdinal:1});
  assert.equal(request.externalCalls,1);assert.equal(request.model,'gpt-image-2');assert.match(request.prompt,/frontal 0 degrees/);
  assert.match(request.prompt,/Permanent identity constraints/);assert.match(request.prompt,/Temporary elements to exclude/);

  const passport={id:'passport-cert-1',brandId:BRAND,sourceArtifactId:'passport-artifact',sourceArtifactVersion:1};
  const bodyBuild={id:'body-build-1',profile:{shoulderWidth:'balanced'}};
  const dependencies={avatar:{...avatar,passportCertificationEvents:[passport]},passport,identityLock:lock,bodyBuild,
    preferredProvider:'openai',preferredModel:'gpt-image-2'};
  for(const [kind,type,capability,size] of [['BODY','CHEST_UP_NEUTRAL','CHARACTER_BODY_REFERENCE','1024x1536'],
    ['BODY','FULL_BODY_STANDING_NEUTRAL','CHARACTER_BODY_REFERENCE','1024x1536'],['BODY','SEATED_NEUTRAL','CHARACTER_BODY_REFERENCE','1024x1536'],
    ['EXPRESSION','NEUTRAL','CHARACTER_EXPRESSION_REFERENCE','1024x1024'],['EXPRESSION','WARM_SMILE','CHARACTER_EXPRESSION_REFERENCE','1024x1024'],
    ['EXPRESSION','SERIOUS_CONCERNED','CHARACTER_EXPRESSION_REFERENCE','1024x1024'],['EXPRESSION','ENERGETIC_POSITIVE','CHARACTER_EXPRESSION_REFERENCE','1024x1024'],
    ['MOUTH','OOH','MOUTH_SHAPE_REFERENCE','1024x1024']]){
    const spec=canonicalL2GenerationSpec({...dependencies,kind,referenceType:type});assert.equal(spec.providerCapability,capability);
    assert.equal(spec.preferredModel,'gpt-image-2');assert.equal(spec.costPlan.status,'PARTIAL');
    assert.deepEqual(spec.identityConstraints,lock.permanentAttributes);assert.deepEqual(spec.temporaryExclusions,lock.temporaryAttributes);
    assert.equal(spec.costPlan.estimatedOutputCostPerCall,estimateOpenAIImagePlan({model:'gpt-image-2',size,quality:'high'}).estimatedOutputCostPerCall);
  }

  const tokenRates=imageTokenRates('gpt-image-2');assert.deepEqual(tokenRates.perMillionTokens,{textInput:5,imageInput:8,imageOutput:30});
  assert.equal(actualOpenAIImageCost({model:'gpt-image-2',usage:{input_tokens_details:{text_tokens:100,image_tokens:200},output_tokens:300}}),0.0111);
  assert.equal(actualOpenAIImageCost({model:'gpt-image-2',usage:{output_tokens:300}}),null,'missing input components stay UNKNOWN');

  let mockExternalCalls=0;const requests=[];const provider=createOpenAIMediaProvider({client:{images:{async edit(input){mockExternalCalls+=1;requests.push(input);
    return{id:`mock-${mockExternalCalls}`,data:[{b64_json:Buffer.from(`mock-${mockExternalCalls}`).toString('base64')}],usage:{
      input_tokens_details:{text_tokens:100,image_tokens:200},output_tokens:300}}},async generate(){throw new Error('not expected')}},audio:{speech:{}}}});
  assert.equal(DEFAULT_IMAGE_MODEL,'gpt-image-2');
  for(const [capability,size] of [['multi-view-identity-reference','1536x1024'],['character-body-reference','1024x1536'],
    ['character-expression-reference','1024x1024'],['mouth-shape-reference','1024x1024']]){
    const result=await provider.generate({capability,model:'gpt-image-2',prompt:JSON.stringify({description:'canonical mock',generation_requirements:{
      prompt:'preserve Identity Lock',size,quality:'high'}}),referenceImages:[{bytes:Buffer.from('reference'),filename:'reference.jpg',contentType:'image/jpeg'}]});
    assert.equal(result.model,'gpt-image-2');assert.equal(result.actualKnownCost,0.0111);assert.equal(result.provenance.inputFidelity,'AUTOMATIC_HIGH_FIDELITY');
  }
  assert.equal(mockExternalCalls,4,'one mock call each for Passport, chest-up, expression, and mouth compilation');
  assert(requests.every((item)=>item.model==='gpt-image-2'&&item.n===1&&item.quality==='high'));
  assert.equal(requests[0].size,'1536x1024');assert.equal(requests[1].size,'1024x1536');

  let storedExecution=null,repositoryPlan={...plan,id:'plan-1'};const repo={async getCharacter(){return avatar},async generationSpec(){return repositoryPlan},async source(){return source},
    async intake(){return intake},async createPassportExecution({preflight}){storedExecution={id:'execution-1',workspaceId:WORKSPACE,brandId:BRAND,
      verticalCode:'TRAVEL',characterId:'avatar-1',identityVersionId:'identity-1',generationSpecId:'plan-1',provider:preflight.snapshot.provider,
      model:preflight.snapshot.model,adapterFamily:preflight.snapshot.adapterFamily,candidateCount:preflight.snapshot.candidateCount,
      totalPlannedCalls:preflight.snapshot.totalPlannedCalls,costPlan:preflight.snapshot.costPlan,maximumAllowedCost:preflight.snapshot.maximumAllowedCost,
      inputSnapshot:preflight.snapshot,preflightFingerprint:preflight.preflightFingerprint,attempts:[],approval:null};return storedExecution},
    async addPassportExecutionEvent(){return{}},async passportExecution(){return storedExecution},async createPassportExecutionApproval({preflight}){
      storedExecution.approval={preflightFingerprint:preflight.preflightFingerprint};return storedExecution.approval}};
  const service=new PassportExecutionService({repository:repo,providerCatalog:catalog,providerGateway:{async generate(){throw new Error('forbidden')}},
    assetIntakeService:{eligibility(){return{eligible:true,failures:[]}}},storage:{},env:{LIVE_PAID_GENERATION:'false'}});
  const scope={workspaceId:WORKSPACE,brandId:BRAND,vertical:'TRAVEL',avatarId:'avatar-1',identityVersionId:'identity-1'};
  await assert.rejects(()=>service.preflight({...scope,generationSpecId:'plan-1',maximumAllowedCost:0.1,executionCandidateCount:1}),{code:'BUDGET_EXCEEDED'});
  const preflight=await service.preflight({...scope,generationSpecId:'plan-1',maximumAllowedCost:0.5,executionCandidateCount:1});
  assert.equal(preflight.costPlan.status,'PARTIAL');assert.equal(preflight.costPlan.knownSubtotalCost,0);
  assert.equal(preflight.costPlan.estimatedOutputCost,0.165);
  await assert.rejects(()=>service.approve({...scope,executionId:'execution-1',explicitConfirmation:true}),{code:'UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED'});
  const originalModel=repositoryPlan.preferredModel;repositoryPlan.preferredModel='gpt-image-1';
  await assert.rejects(()=>service.approve({...scope,executionId:'execution-1',explicitConfirmation:true,unknownCostAcknowledged:true}),{code:'STALE_PREFLIGHT'});
  repositoryPlan.preferredModel=originalModel;

  const approvedExecution={...storedExecution,model:'gpt-image-2',provider:'openai',preflightSnapshot:{generationPlanFingerprint:plan.planFingerprint},
    approval:{preflightFingerprint:storedExecution.preflightFingerprint},maximumAllowedCost:0.5,costPlan:preflight.costPlan};
  const ready=buildSmokeReadiness({kind:'PASSPORT',env:{OPENAI_API_KEY:'super-secret-value',LIVE_PAID_GENERATION:'true'},providerCatalog:catalog,
    avatar,source,intake,generationSpec:plan,execution:approvedExecution});
  assert.equal(ready.checks.OPENAI_API_KEY,'YES');assert.equal(ready.checks.costStatus,'PARTIAL');assert.equal(ready.checks.budgetCeiling,'SET');
  assert.equal(ready.checks.humanApproval,'VALID');assert.equal(JSON.stringify(ready).includes('super-secret-value'),false);assert.equal(ready.secretsRedacted,true);
  const bodyBlocked=buildSmokeReadiness({kind:'BODY',env:{OPENAI_API_KEY:'x',LIVE_PAID_GENERATION:'true'},providerCatalog:catalog,
    avatar,source,intake,generationSpec:{...plan,preferredModel:'gpt-image-2'},execution:approvedExecution});
  assert.equal(bodyBlocked.checks.certifiedPassport,'NO');assert(bodyBlocked.blockers.includes('CERTIFIED_PASSPORT_REQUIRED'));
  assert.equal(mockExternalCalls,4);assert.equal(ready.paidProviderCalls,0);assert.equal(ready.externalGenerationCalls,0);
  console.log('Avatar Studio V1.3.1 current image provider/readiness passed; paid provider calls=0; real external generation calls=0; mock image calls=4');
}

main().catch((error)=>{console.error(error);process.exitCode=1});
