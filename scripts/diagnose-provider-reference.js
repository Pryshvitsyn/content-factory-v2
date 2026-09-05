'use strict';
// Local-only operational diagnostic. No provider gateway or approval/start API is used.
const fs=require('node:fs/promises'),path=require('node:path');
require('dotenv').config({quiet:true});
process.env.LIVE_PAID_GENERATION='false';
const {Pool}=require('pg');
const {discoverLocalDatabase,localStorageRoot}=require('./local-runtime');
const {AvatarStudioPostgresRepository}=require('../src/avatar-studio/postgres-repository');
const {FilesystemStorageAdapter}=require('../src/storage/storage-adapter');
const {ArtifactService}=require('../src/artifacts/artifact-service');
const {AvatarIdentityQaService}=require('../src/avatar-studio/avatar-identity-qa-service');
const {AvatarPoseQaService}=require('../src/avatar-studio/avatar-pose-qa-service');
const {LocalOpenCvAvatarIdentityEvaluator}=require('../src/avatar-studio/local-opencv-avatar-evaluator');
const {AvatarProviderReferenceCanonicalizer,sha}=require('../src/avatar-studio/provider-reference-canonicalizer');
const {AvatarMotionPilotService}=require('../src/avatar-studio/motion-pilot-service');
const {ProviderCatalog}=require('../src/v2.8/provider-catalog');
const {loadMotionPilotPolicy}=require('../src/avatar-studio/motion-pilot-policy');
async function main(){
 const sourceId=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(sourceId||''))throw Error('Usage: node scripts/diagnose-provider-reference.js <source-intake-id> [--refresh-batch]');
 const db=new Pool({connectionString:discoverLocalDatabase(process.env).url}),evaluator=new LocalOpenCvAvatarIdentityEvaluator();
 try{
  const row=(await db.query('SELECT id,brand_id,character_id FROM avatar_studio.asset_intakes WHERE id=$1',[sourceId])).rows[0];if(!row)throw Error('SOURCE_NOT_FOUND');
  const repository=new AvatarStudioPostgresRepository({db}),storage=new FilesystemStorageAdapter({root:localStorageRoot(process.env)}),avatar=await repository.getCharacter({id:row.character_id,brandId:row.brand_id});
  const source=await repository.intake({id:sourceId,brandId:row.brand_id,avatarId:avatar.id});
  const identityQaService=new AvatarIdentityQaService({repository,storage,evaluator}),poseQaService=new AvatarPoseQaService({evaluator});
  const canonicalizer=new AvatarProviderReferenceCanonicalizer({repository,storage,artifactService:new ArtifactService({storage}),identityQaService,poseQaService});
  const route=loadMotionPilotPolicy().routes.WAN_27_R2V_MULTI_REFERENCE;
  const bytes=await storage.get({key:source.artifactStorageKey});if(sha(bytes)!==source.contentHash)throw Error('SOURCE_HASH_MISMATCH');
  const result=await canonicalizer.prepare({avatar,brandId:row.brand_id,source,route});
  const truthSet=await identityQaService.truthSet({avatar,brandId:row.brand_id});
  const beforeQa=await identityQaService.evaluateDerivedImage({truthSet,candidateImage:bytes}),beforePose=await poseQaService.inspect({image:bytes});
  const batches=(await db.query('SELECT id FROM avatar_studio.motion_pilot_quality_batches WHERE character_id=$1 AND brand_id=$2 ORDER BY created_at DESC',[avatar.id,row.brand_id])).rows;
  const batch=batches[0]?await repository.motionPilotQualityBatch({id:batches[0].id}):null;
  const previous=batch?await repository.latestMotionPilotQualityBatchPreflight({batchId:batch.id}):null;
  let refreshed=null;
  if(result.status==='PASS'&&process.argv.includes('--refresh-batch')){
    if(!batch)throw Error('BATCH_NOT_FOUND');
    const pilot=new AvatarMotionPilotService({repository,providerCatalog:new ProviderCatalog({env:process.env}),storage,identityQaService,providerReferenceCanonicalizer:canonicalizer,env:{...process.env,LIVE_PAID_GENERATION:'false'},adapterFactory:()=>{throw Error('PROVIDER_CALL_FORBIDDEN');}});
    refreshed=await pilot.preflightQualityBatch({batchId:batch.id,...pilot.batchScope(batch)});
  }
  const {bytes:outputBytes,...safe}=result;
  const report={source:{id:source.id,artifactId:source.artifactId,sourceHash:source.contentHash,width:source.width,height:source.height},beforeQa,beforePose,canonicalization:safe,
    previousPreflight:previous?{id:previous.id,revision:previous.revision,status:previous.status,dimensions:previous.snapshot.dimensions,routeScope:previous.snapshot.routeScope}:null,
    refreshedPreflight:refreshed,refreshSkippedReason:result.status!=='PASS'?'CANONICALIZATION_BLOCKED':refreshed?null:'REFRESH_NOT_REQUESTED',paidProviderCalls:0,externalGenerationCalls:0,embeddingsPersisted:false};
  const dir=path.resolve('.tmp/provider-reference-diagnostics');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`${sourceId}-${Date.now()}.json`);await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({report:output,status:result.status,reason:result.detailCode||null,sourceHash:source.contentHash,faceCount:result.before?.faces.length,faces:result.before?.faces.map(f=>({index:f.faceIndex,confidence:f.confidence,box:f.box,area:f.area,frameAreaRatio:f.areaRatio,center:f.center,identity:f.identity.status,scores:f.observations.map(o=>o.cosine),associations:f.associations})),personCount:result.before?.personCount,refreshedPreflight:refreshed?.preflightId||null,paidProviderCalls:0,externalGenerationCalls:0},null,2));
 }finally{evaluator.close();await db.end();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
