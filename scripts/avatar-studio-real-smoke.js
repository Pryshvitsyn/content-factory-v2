'use strict';

const readline = require('node:readline/promises');

function argumentsFrom(argv) {
  const result={};for(let index=0;index<argv.length;index+=2){const key=argv[index],value=argv[index+1];
    if(!key?.startsWith('--')||value==null)throw new Error('Arguments must be --name value pairs');result[key.slice(2)]=value;}return result;
}
async function request(base,path,{method='GET',body=null}={}){
  const response=await fetch(`${base}${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined});const payload=await response.json();
  if(!response.ok)throw new Error(`${payload?.error?.code||response.status}: ${payload?.error?.message||'Request failed'}`);return payload;
}
async function confirmFingerprint(preflight){
  process.stdout.write(`${JSON.stringify({provider:preflight.provider,model:preflight.model,capability:preflight.capability,
    callsPerCandidate:preflight.callsPerCandidate||1,totalPlannedCalls:preflight.totalPlannedCalls,
    costPlan:preflight.costPlan,maximumAllowedCost:preflight.maximumAllowedCost,
    preflightFingerprint:preflight.preflightFingerprint},null,2)}\n`);
  const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
  const answer=await terminal.question(`Type the exact preflight fingerprint to approve ONE paid call:\n${preflight.preflightFingerprint}\n> `);terminal.close();
  if(answer.trim()!==preflight.preflightFingerprint)throw new Error('Fingerprint confirmation did not match; stopped before approval and generation');
}
async function main(){
  const args=argumentsFrom(process.argv.slice(2)),kind=String(args.kind||'').toUpperCase();
  for(const key of ['kind','avatar-id','brand-id','maximum-allowed-cost','confirm-one-paid-call','acknowledge-partial-cost'])if(!args[key])throw new Error(`--${key} is required`);
  if(!['PASSPORT','BODY'].includes(kind))throw new Error('--kind must be PASSPORT or BODY');
  if(args['confirm-one-paid-call']!=='YES'||args['acknowledge-partial-cost']!=='YES')throw new Error('Both paid-call and partial-cost acknowledgements must be exactly YES');
  if(kind==='PASSPORT'&&!args['source-asset-id'])throw new Error('--source-asset-id is required for PASSPORT');
  const budget=Number(args['maximum-allowed-cost']);if(!Number.isFinite(budget)||budget<=0)throw new Error('--maximum-allowed-cost must be positive');
  const base=args['api-base']||'http://127.0.0.1:3001',avatarId=args['avatar-id'],brandId=args['brand-id'];
  const avatar=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}?brandId=${encodeURIComponent(brandId)}`);
  const scope={workspaceId:avatar.workspaceId,brandId,vertical:avatar.verticalCode||avatar.vertical,identityVersionId:avatar.identityVersionId};
  let plan,preflight,approvePath,generatePath,readinessBody;
  if(kind==='PASSPORT'){
    plan=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/passport-generation-plans`,{method:'POST',body:{brandId,
      sourceAssetIds:[args['source-asset-id']],requestedCandidateCount:3,preferredProvider:'openai',preferredModel:'gpt-image-2'}});
    preflight=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/passport-generation-plans/${encodeURIComponent(plan.id)}/preflight`,
      {method:'POST',body:{...scope,maximumAllowedCost:budget,executionCandidateCount:1}});
    approvePath=`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/passport-executions/${encodeURIComponent(preflight.executionId)}/approve`;
    generatePath=`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/passport-executions/${encodeURIComponent(preflight.executionId)}/generate`;
    readinessBody={...scope,kind,sourceAssetId:args['source-asset-id'],generationSpecId:plan.id,executionId:preflight.executionId};
  }else{
    if(Number(avatar.currentLevel)<1)throw new Error('SMOKE B requires a human-certified L1 Passport');
    plan=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/l2-generation-plans`,{method:'POST',body:{...scope,kind:'BODY',
      referenceType:'CHEST_UP_NEUTRAL',requestedCandidateCount:1,preferredProvider:'openai',preferredModel:'gpt-image-2'}});
    preflight=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/l2-generation-plans/${encodeURIComponent(plan.id)}/preflight`,
      {method:'POST',body:{...scope,maximumAllowedCost:budget}});
    approvePath=`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/l2-executions/${encodeURIComponent(preflight.executionId)}/approve`;
    generatePath=`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/l2-executions/${encodeURIComponent(preflight.executionId)}/generate`;
    readinessBody={...scope,kind,generationSpecId:plan.id,executionId:preflight.executionId};
  }
  if(preflight.model!=='gpt-image-2'||Number(preflight.totalPlannedCalls)!==1)throw new Error('Smoke invariant failed: expected gpt-image-2 and exactly one provider call');
  await confirmFingerprint(preflight);
  await request(base,approvePath,{method:'POST',body:{...scope,explicitConfirmation:true,unknownCostAcknowledged:true}});
  const readiness=await request(base,`/api/avatar-studio/avatars/${encodeURIComponent(avatarId)}/smoke-readiness`,{method:'POST',body:readinessBody});
  process.stdout.write(`${JSON.stringify(readiness,null,2)}\n`);if(!readiness.ready)throw new Error(`Readiness blocked: ${readiness.blockers.join(', ')}`);
  const result=await request(base,generatePath,{method:'POST',body:scope});
  process.stdout.write(`${JSON.stringify({kind,executionId:preflight.executionId,plannedProviderCalls:1,result},null,2)}\n`);
}
main().catch((error)=>{process.stderr.write(`${error.message}\n`);process.exitCode=1});
