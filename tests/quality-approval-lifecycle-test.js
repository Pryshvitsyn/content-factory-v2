'use strict';
const assert = require('node:assert/strict');
const { recordQualityApproval } = require('../src/v2.10/quality-approval-events');
const args = { draftId:'draft',workspaceId:'workspace',brandId:'brand',stage:'STORYBOARD',
  subjectType:'STORYBOARD_REVISION',subjectId:'revision',subjectFingerprint:'fingerprint',
  decision:'APPROVED',actor:'test' };
function fixture() {
  const events = []; let sequence=0, tail=Promise.resolve();
  const db = { async connect() {
    const previous=tail; let unlock; tail=new Promise(r=>{unlock=r;}); await previous;
    let snapshot;
    return { release:unlock, async query(sql, params=[]) {
      if(sql==='BEGIN') snapshot=events.slice();
      if(sql==='ROLLBACK') events.splice(0, events.length, ...snapshot);
      if(sql.includes('FROM v2_10.creative_drafts')) return {rows:params[2]==='brand'?[{id:params[0]}]:[]};
      if(sql.startsWith('SELECT *')) return {rows:events.filter(e=>e.draft_id===params[0]
        && e.workspace_id===params[1] && e.brand_id===params[2] && e.stage===params[3]).slice(-1)};
      if(sql.startsWith('INSERT')) {
        const keys=['draft_id','workspace_id','brand_id','stage','subject_type','subject_id','subject_fingerprint','decision','reason','actor'];
        const row={id:String(++sequence),...Object.fromEntries(keys.map((k,i)=>[k,params[i]]))};
        events.push(row); return {rows:[row]};
      }
      return {rows:[]};
    }};
  }};
  return {db,events};
}
(async()=>{
  const {db,events}=fixture();
  const first=await recordQualityApproval(db,args);
  assert.equal((await recordQualityApproval(db,args)).id,first.id);
  assert.equal(events.length,1);
  await recordQualityApproval(db,{...args,decision:'INVALIDATED',reason:'INPUT_CHANGED'});
  const again=await recordQualityApproval(db,args);
  assert.notEqual(again.id,first.id);
  assert.deepEqual(events.map(e=>e.decision),['APPROVED','INVALIDATED','APPROVED']);
  const concurrent=await Promise.all(Array.from({length:8},()=>recordQualityApproval(db,args)));
  assert(concurrent.every(e=>e.id===again.id)); assert.equal(events.length,3);
  await recordQualityApproval(db,{...args,decision:'REJECTED'});
  assert.notEqual((await recordQualityApproval(db,args)).id,again.id);
  await assert.rejects(()=>recordQualityApproval(db,{...args,brandId:'other'}),{code:'DRAFT_NOT_FOUND'});
  await assert.rejects(()=>recordQualityApproval(db,{...args,workspaceId:''}),{code:'QUALITY_APPROVAL_INPUT_REQUIRED'});
  const before=events.length;
  await recordQualityApproval(db,{...args,stage:'LOOK',subjectType:'KEYFRAME'});
  assert.equal(events.length,before+1);
  console.log('PASS: active duplicate, invalidation/reapproval, rejection/reapproval, serialized concurrent requests, scope, stage isolation. Provider calls: 0.');
})().catch(e=>{console.error(e);process.exitCode=1;});
