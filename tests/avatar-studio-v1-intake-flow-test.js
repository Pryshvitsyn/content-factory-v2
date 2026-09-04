'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadIdentityIntakePolicy } = require('../src/avatar-studio/identity-intake-policy');
const { coverageFromSources } = require('../src/avatar-studio/identity-coverage');
const { canonicalCharacter } = require('../src/avatar-studio/domain');

const policy=loadIdentityIntakePolicy();
const base={characterId:'avatar',brandId:'brand',roles:['IDENTITY'],effectiveViewpoint:'FRONTAL',contentHash:'a'};
const intake=(source,status='PASS')=>({id:`i-${source.contentHash}`,characterId:source.characterId,brandId:source.brandId,contentHash:source.contentHash,effectiveGate0Status:status});
const result=(views,options={})=>coverageFromSources(views.map((viewpoint,index)=>({...base,id:`s${index}`,effectiveViewpoint:viewpoint,contentHash:options.sameHash?'same':String(index),characterId:options.wrongAvatar&&index===0?'other':'avatar',brandId:options.wrongBrand&&index===0?'other':'brand'})),source=>({ ...intake(source,options.rejected&&source.effectiveViewpoint==='THREE_QUARTER_RIGHT'?'BLOCK':'PASS'), characterId:options.wrongAvatar&&source.effectiveViewpoint==='FRONTAL'?'avatar':source.characterId, brandId:options.wrongBrand&&source.effectiveViewpoint==='FRONTAL'?'brand':source.brandId }));
assert.equal(policy.schemaVersion,1);assert.equal(policy.photoBatch.maximum,10);assert.deepEqual(policy.minimumIdentityCoverage.required,['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT']);
const invalid=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'intake-policy-')),'bad.json');fs.writeFileSync(invalid,'{}');assert.throws(()=>loadIdentityIntakePolicy(invalid),e=>e.code==='IDENTITY_INTAKE_POLICY_INVALID');fs.rmSync(path.dirname(invalid),{recursive:true,force:true});
assert.equal(result(['FRONTAL']).status,'NOT_READY');assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT']).status,'NOT_READY');assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT']).status,'READY_FOR_IDENTITY_LOCK');assert.equal(result(policy.canonicalViewpoints).status,'STRONG_COVERAGE');
assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT'],{rejected:true}).status,'NOT_READY');assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT'],{sameHash:true}).coverageCount,1);assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT'],{wrongAvatar:true}).status,'NOT_READY');assert.equal(result(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT'],{wrongBrand:true}).status,'NOT_READY');
const character=canonicalCharacter({internalName:'A',vertical:'TRAVEL',brandIds:['brand'],subjectType:'REAL',ageClass:'MINOR',identity:{agePresentation:'declared',personality:'x',role:'x',languages:['und'],visualDirection:'x',permanentAttributes:{},prohibitedUses:['x']}});assert.equal(character.subjectType,'CONSENTED_REAL_PERSON');assert.equal(character.provenance.ageClass,'MINOR');assert.throws(()=>canonicalCharacter({internalName:'A',vertical:'TRAVEL',brandIds:['brand'],subjectType:'REAL',identity:{agePresentation:'x',personality:'x',role:'x',languages:['und'],visualDirection:'x',permanentAttributes:{},prohibitedUses:['x']}}),e=>e.code==='AGE_CLASS_REQUIRED');
assert.equal(process.env.PAID_PROVIDER_CALLS||'0','0');assert.equal(process.env.EXTERNAL_GENERATION_CALLS||'0','0');console.log('Avatar Studio V1 identity intake policy, coverage, duplicate, scope, Gate 0 and explicit age-class regressions passed; PAID_PROVIDER_CALLS=0 EXTERNAL_GENERATION_CALLS=0');
