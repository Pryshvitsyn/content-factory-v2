'use strict';
// Explicit operator command. Uses normal validation/approval routes, never SQL data edits.
const assert = require('node:assert/strict');
const flags=process.argv.slice(2);
const option=name=>flags[flags.indexOf(name)+1];
const draftId=option('--draft'),brandId=option('--brand');
const negative='No extra people, duplicated people, extra limbs, malformed hands or distorted faces. No additional phones or bags. Keep the same faces, hairstyles, clothing, kitchen layout and daylight. No captions, logos, watermarks or generated app interfaces. No exaggerated expressions, sudden camera movements or cuts within the shot.';
(async()=>{
 assert(flags.includes('--confirm'),'Run with --confirm to save and approve the reviewed storyboard.');
 assert(/^[a-f0-9-]{36}$/i.test(draftId||'') && /^[a-f0-9-]{36}$/i.test(brandId||''),'Supply --draft UUID --brand UUID');
 const base=`http://127.0.0.1:3001/api/v2.10/creative-drafts/${draftId}`;
 async function api(suffix='',body) {
  const r=await fetch(base+suffix,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify({brandId,...body})}:{})});
  const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data.error||data));return data;
 }
 const state=await api(`/quality-director?brandId=${brandId}`);
 assert(state.script?.approved,'Script must already be approved.');
 const current=state.storyboard?.revision;assert(current?.content?.shots?.length,'Saved storyboard missing.');
 assert(current.content.scriptFingerprint===state.script.fingerprint,'Storyboard belongs to a different script; stop for review.');
 const draft=await api(`?brandId=${brandId}`);
 assert(draft.brand_id===brandId && draft.id===draftId,'Draft scope mismatch.');
 const legacy=new Map(draft.creative_brief.storyboard.map(s=>[s.shotId,s]));
 const lines=v=>Array.isArray(v)?v.filter(s=>String(s).trim()):String(v||'').split('\n').map(s=>s.trim()).filter(Boolean);
 let changed=false;
 const shots=current.content.shots.map(s=>{
   assert(legacy.has(s.shotId),`Shot ${s.shotId} missing from canonical draft`);
   if(lines(s.negativeGuidance).length)return s;
   const existing=lines(legacy.get(s.shotId).negativeGuidance);
   changed=true;return {...s,negativeGuidance:existing.length?existing:[negative]};
 });
 let revision=current;
 if(changed){
  const saved=await api('/quality-director/storyboard-save',{storyboard:{...current.content,shots}});
  assert(saved.validation?.status==='PASS','Saved storyboard validation failed; approval not sent.');
  revision=saved.storyboard;
  console.log('Ограничения сохранены в раскадровке. Ревизия:',revision.revision);
 }
 if(changed || !state.storyboard.approved){
  await api('/quality-director/storyboard-approve',{storyboardRevisionId:revision.id,confirmation:true});
 }
 const verified=await api(`/quality-director?brandId=${brandId}`);
 assert(verified.storyboard?.approved && verified.storyboard.revision.id===revision.id,
  'Approval did not remain current. Stop; no generation was requested.');
 const after=await api(`?brandId=${brandId}`);
 assert(after.creative_brief.storyboard.every(s=>lines(s.negativeGuidance).length),'Canonical negative guidance is empty.');
 console.log('STORYBOARD APPROVED: true');
 console.log('REVISION:',verified.storyboard.revision.revision);
 console.log('NEGATIVE GUIDANCE: сохранено во всех кадрах');
 console.log('Генерация: 0 вызовов. Обнови браузер; проверь состояние keyframe и новый preflight.');
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exitCode=1;});
