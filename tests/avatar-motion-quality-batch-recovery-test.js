'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {AvatarMotionPilotService}=require('../src/avatar-studio/motion-pilot-service');

const scope={workspaceId:'workspace-1',brandId:'brand-1',vertical:'FASHION',avatarId:'avatar-1',identityVersionId:'version-1'};
function fixture({status='APPROVED',stale=false,withApproval=true,withPreflight=true,approvalRevision=11}={}) {
  let reads=0,writes=0,providerCalls=0;
  const snapshot={scopeFingerprint:'scope-1',snapshotFingerprint:'snapshot-1',status:'READY',dimensions:{PROVIDER_INPUT_IDENTITY_QA:'PASS'},routeScope:[{routeId:'WAN_27_R2V_MULTI_REFERENCE'}],blockers:[]};
  const preflight={id:'preflight-11',revision:11,status:'READY',snapshot,snapshotFingerprint:'snapshot-1'};
  const approval=withApproval?{approvalId:'approval-1',preflightId:preflight.id,preflightRevision:approvalRevision,preflightFingerprint:'snapshot-1'}:null;
  const batch={id:'batch-1',...scope,characterId:scope.avatarId,status,preferredRouteId:'WAN_27_R2V_MULTI_REFERENCE',allowedRouteIds:['WAN_27_R2V_MULTI_REFERENCE'],maximumVariants:2,maximumTotalCostUsd:'1.000000',cumulativeActualKnownCostUsd:'0.000000',approvalMetadata:approval};
  const repository={async latestMotionPilotQualityBatch(value){reads++;assert.deepEqual(value,scope);return batch;},async latestMotionPilotQualityBatchPreflight(){reads++;return withPreflight?preflight:null;},async motionPilotQualityBatchChildren(){reads++;return [];}};
  const service=Object.create(AvatarMotionPilotService.prototype);Object.assign(service,{repository,async batchReadiness(){reads++;return {...snapshot,status:stale?'BLOCKED':'READY',scopeFingerprint:stale?'changed':'scope-1',blockers:stale?[{code:'MOTION_QUALITY_BATCH_PREFLIGHT_STALE'}]:[]};}});
  return {service,get reads(){return reads;},get writes(){return writes;},get providerCalls(){return providerCalls;}};
}

test('plan/preflight/approved batch read model survives repeated reloads without mutation or provider calls',async()=>{const h=fixture(),first=await h.service.qualityBatchState(scope),second=await h.service.qualityBatchState(scope);for(const state of [first,second]){assert.equal(state.batch.id,'batch-1');assert.equal(state.batch.status,'APPROVED');assert.equal(state.preflight.revision,11);assert.equal(state.preflight.status,'READY_FOR_APPROVAL');assert.equal(state.approval.current,true);assert.equal(state.startable,true);assert.deepEqual(state.batch.allowedRouteIds,['WAN_27_R2V_MULTI_REFERENCE']);assert.equal(state.batch.maximumVariants,2);assert.equal(Number(state.batch.maximumTotalCostUsd),1);assert.equal(state.childrenCount,0);assert.equal(state.providerCallsExecuted,0);assert.equal(state.remainingBudgetUsd,1);}assert.equal(h.writes,0);assert.equal(h.providerCalls,0);});

test('safe-mode process restart does not invalidate approval and paid-mode is not part of durable read state',async()=>{const safe=fixture(),paid=fixture();const before=await safe.service.qualityBatchState(scope),after=await paid.service.qualityBatchState(scope);assert.equal(before.startable,true);assert.equal(after.startable,true);assert.equal(before.approval.approvalId,after.approval.approvalId);assert.equal(safe.providerCalls+paid.providerCalls,0);});

test('ready preflight without approval restores as non-startable',async()=>{const h=fixture({status:'AWAITING_APPROVAL',withApproval:false}),state=await h.service.qualityBatchState(scope);assert.equal(state.preflight.status,'READY_FOR_APPROVAL');assert.equal(state.approval,null);assert.equal(state.startable,false);assert.equal(h.writes,0);});

test('changed approved input scope is exposed as STALE and cannot start',async()=>{const h=fixture({stale:true}),state=await h.service.qualityBatchState(scope);assert.equal(state.batch.status,'STALE');assert.equal(state.approval.current,false);assert.equal(state.startable,false);assert.equal(state.preflight.readiness.status,'BLOCKED');assert.equal(h.providerCalls,0);});

test('planned batch survives reload before a preflight exists',async()=>{const h=fixture({status:'PLANNED',withApproval:false,withPreflight:false}),state=await h.service.qualityBatchState(scope);assert.equal(state.batch.id,'batch-1');assert.equal(state.batch.status,'PLANNED');assert.equal(state.preflight,null);assert.equal(state.startable,false);assert.equal(h.writes,0);assert.equal(h.providerCalls,0);});

test('approval bound to an older preflight revision fails closed after reload',async()=>{const h=fixture({approvalRevision:10}),state=await h.service.qualityBatchState(scope);assert.equal(state.batch.status,'STALE');assert.equal(state.approval.current,false);assert.equal(state.startable,false);assert.equal(h.providerCalls,0);});
