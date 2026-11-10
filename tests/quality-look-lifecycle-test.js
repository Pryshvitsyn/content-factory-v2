'use strict';
const assert = require('node:assert/strict');
const { describeLook, lookFingerprint } = require('../src/v2.10/quality-look-lifecycle');
const { QualityLockedKeyframeService } = require('../src/v2.10/quality-locked-keyframe-service');
const { QualityCreativeProductionService } = require('../src/v2.10/quality-creative-production-service');
const { CreativeProductionService } = require('../src/v2.10/creative-production-service');
const state = { script: { approved: true, fingerprint: 's1', eventId: 'se1' },
  storyboard: { approved: true, fingerprint: 'b1', eventId: 'be1' }, look: {} };
const k = { id:'k1', version:1, content_hash:'hash', storage_key:'immutable/k1', validation_status:'PASS',
  validation_event_id:'v1', approval_decision:'APPROVED' };
const ref = { artifactId:k.id, version:1, contentHash:k.content_hash, storageKey:k.storage_key };
const event = { id:'l1', decision:'APPROVED', subject_id:k.id, subject_fingerprint:lookFingerprint(state,k) };
const active = describeLook(state,k,ref,event);
assert(active.approved);
assert.deepEqual(JSON.parse(JSON.stringify(active)), active, 'reload preserves lifecycle state');
for (const changed of [ { ...state, script:{...state.script,eventId:'se2'} },
  { ...state, storyboard:{...state.storyboard,fingerprint:'b2'} } ]) {
  const look=describeLook(changed,k,ref,event);assert(!look.approved);assert(look.canApprove);assert.equal(look.status,'REVIEW_REQUIRED');
}
assert(!describeLook(state,{...k,content_hash:'new'},ref,event).approved);
assert(!describeLook(state,k,{...ref,version:2},event).approved);
assert(!describeLook(state,k,ref,{...event,subject_fingerprint:'legacy-unbound-hash'}).approved);
assert(!describeLook(state,{...k,validation_status:'FAIL'},ref,event).canApprove);
assert(describeLook(state,{...k,approval_decision:null},null,null).canApprove,'first frame approval is possible');
assert(!describeLook({...state,script:{approved:false}},k,ref,event).canApprove);

async function main(){
 const service=Object.create(QualityLockedKeyframeService.prototype);
 const lifecycle={...state,look:active};let writes=0;
 service.requireDirectorGate=async()=>lifecycle;service.scope=async()=>({workspaceId:'w',brandId:'b'});
 service.repository={getKeyframe:async()=>k, recordCurrentLookApproval:async()=>{writes++;}};
 const args={id:'d',brandId:'b',keyframeId:'k1',lookFingerprint:active.expectedFingerprint,confirmation:true};
 const repeated=await service.approveKeyframe(args);assert(repeated.reused);assert.equal(writes,0,'repeated approval must not reset pilot/preflight');
 await assert.rejects(()=>service.approveKeyframe({...args,lookFingerprint:'old'}),e=>e.code==='STALE_LOOK_APPROVAL');
 await assert.rejects(()=>service.approveKeyframe({...args,keyframeId:'foreign'}),e=>e.code==='STALE_LOOK_APPROVAL');
 await assert.rejects(()=>service.approveKeyframe({...args,confirmation:false}),e=>e.code==='EXPLICIT_CONFIRMATION_REQUIRED');
 lifecycle.look={...active,approved:false};
 service.draft=async()=>({creative_brief:{storyboard:[{referenceMedia:ref}]}});
 await service.approveKeyframe(args);assert.equal(writes,1,'reapproval of bound frame records LOOK without rebinding or generation');
 // Preflight must stop at LOOK before reaching any canonical/provider implementation.
 const creative=Object.create(QualityCreativeProductionService.prototype);
 creative.scope=service.scope;creative.repository={assertQualityDirectorGate:async({requiredStages})=>{
  assert(requiredStages.includes('LOOK'));throw Object.assign(new Error('LOOK required'),{code:'LOOK_APPROVAL_REQUIRED'});}};
 await assert.rejects(()=>creative.preflight(args),e=>e.code==='LOOK_APPROVAL_REQUIRED');
 // Verify the response differentiates pilot readiness from authorization for full production.
 const original=CreativeProductionService.prototype.preflight;
 try{
  CreativeProductionService.prototype.preflight=async()=>({status:'READY'});
  creative.repository={assertQualityDirectorGate:async()=>{},getQualityDirectorState:async()=>({...state,look:active,pilot:{approved:false}})};
  const preflight=await creative.preflight(args);assert.equal(preflight.startAllowed,false);assert.equal(preflight.readinessLabel,'READY FOR PILOT ONLY');
 }finally{CreativeProductionService.prototype.preflight=original;}
 const {QualityScriptFirstService}=require('../src/v2.10/quality-script-first-service');
 const director=Object.create(QualityScriptFirstService.prototype);
 const sr={id:'sr',fingerprint:'s',validation:{status:'PASS'},content:{}};
 const br={id:'br',fingerprint:'b',validation:{status:'PASS'},content:{scriptFingerprint:'s'}};
 director.scope=service.scope;director.draft=async()=>({creative_brief:{}});
 director.repository={getLatestQualityScript:async()=>sr,getLatestQualityStoryboard:async()=>br,
   getQualityDirectorState:async()=>({script:{approved:true,fingerprint:'s',revision:sr,eventId:'se'},
     storyboard:{approved:true,fingerprint:'b',revision:br,eventId:'be'}}),
   recordQualityApproval:async()=>{throw Error('Duplicate wrote a new decision');},
   invalidateQualityStages:async()=>{throw Error('Duplicate invalidated downstream');}};
 assert((await director.approveScript({...args,confirmation:true})).reused);
 assert((await director.approveStoryboard({...args,confirmation:true})).reused);
 console.log('PASS: exact LOOK/context binding, reload, first approval, stale/foreign rejection, explicit reapproval, idempotent repeat, preflight stage distinction. Real external calls: 0.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
