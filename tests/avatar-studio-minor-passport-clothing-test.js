'use strict';

const assert = require('node:assert/strict');
const { compilePassportGenerationSpec } = require('../src/avatar-studio/passport-plan-compiler');
const { compilePassportProviderRequest } = require('../src/avatar-studio/passport-provider-compiler');

const lock = { id:'lock-1',identityVersionId:'identity-1',permanentAttributes:{ facialStructure:'preserve' },temporaryAttributes:{ wardrobe:'exclude',jacket:'exclude',hat:'exclude' },uncertainAttributes:{} };
function avatar(minor) { return { id:'avatar-1',workspaceId:'workspace-1',vertical:'PSYCHOLOGY_WELLBEING',identity:{ agePresentation:minor?'MINOR':'adult',permanentAttributes:minor?{subjectAgeClass:'MINOR'}:{} } }; }
const catalog={ listModels(){ return [{modelId:'gpt-image-2',capabilities:['MULTI_VIEW_IDENTITY_REFERENCE'],adapterFamily:'openai-media',costStatus:'PARTIAL'}]; },getAvailability(){return 'CONFIGURED';} };
function plan(minor,repairDelta=null) { return compilePassportGenerationSpec({ avatar:avatar(minor),identityVersion:{id:'identity-1'},identityLock:lock,
  sourceAssets:[{id:'source-1',brandId:'brand-1'}],requestedCandidateCount:3,preferred:{provider:'openai',model:'gpt-image-2'},providerCatalog:catalog,repairDelta }); }
const minorPlan=plan(true);
const minorRequest=compilePassportProviderRequest({generationSpec:{...minorPlan,id:'plan-1'},sourceImages:[{bytes:Buffer.from('source'),filename:'source.png',contentType:'image/png'}],candidateOrdinal:1});
assert(minorPlan.minorWardrobe?.required); assert.match(minorRequest.prompt,/MINOR SAFETY CLOTHING CONTRACT/); assert.match(minorRequest.prompt,/torso remain fully covered/); assert.match(minorRequest.prompt,/Temporary elements to exclude are source details, not identity traits/);
assert.match(minorRequest.prompt,/wardrobe/); assert.match(minorRequest.prompt,/bare torso/); assert.match(minorRequest.prompt,/adultized wardrobe/);
assert.deepEqual(lock.temporaryAttributes,{wardrobe:'exclude',jacket:'exclude',hat:'exclude'},'temporary source wardrobe remains non-identity evidence');
const repaired=compilePassportProviderRequest({generationSpec:{...plan(true,{profile:'preserve nose'}),id:'repair-1'},sourceImages:[{bytes:Buffer.from('source'),filename:'source.png',contentType:'image/png'}],candidateOrdinal:1});
assert.match(repaired.prompt,/MINOR SAFETY CLOTHING CONTRACT/,'repair inherits the same minor-safe clothing contract');
const adultPlan=plan(false); const adultRequest=compilePassportProviderRequest({generationSpec:{...adultPlan,id:'adult-1'},sourceImages:[{bytes:Buffer.from('source'),filename:'source.png',contentType:'image/png'}],candidateOrdinal:1});
assert.equal(adultPlan.minorWardrobe,null); assert(!adultRequest.prompt.includes('MINOR SAFETY CLOTHING CONTRACT'),'adult behavior stays unchanged');
console.log('Minor Passport standardized clothing contract tests passed; provider calls = 0.');
