'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildWan3Input, assertWan3ReferenceGeometry } = require('../src/providers/replicate-universal-video-adapter');
const { V210ReferenceAwareMediaExecutor } = require('../src/v2.10/reference-aware-media');
const { FfmpegReferenceGeometryNormalizer, ReferenceGeometryError, compatible, geometry } = require('../src/v2.10.2/reference-geometry');
const { VisualQualityEvaluator } = require('../src/v2.9/visual-quality-evaluator');
const { QualityRecoveryService } = require('../src/v2.10.1/quality-recovery-service');
const { ProductionCommandService } = require('../src/v2.7/production-command-service');
const { DurableMediaExecutor } = require('../src/v2.5/durable-media-executor');
const { runProcess } = require('../src/v2.1/ffmpeg-master-renderer');

const W='21000000-0000-4000-8000-000000000001',B='21000000-0000-4000-8000-000000000011',P='21000000-0000-4000-8000-000000000021';
const sha=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
const portrait={width:720,height:1280,aspectRatio:.5625,orientation:'PORTRAIT'};
const landscape={width:1280,height:720,aspectRatio:1.777778,orientation:'LANDSCAPE'};
function asset(id='a2',previous='a1'){return{asset_id:id,kind:'video',description:'approved shot',required_for_shots:['s2'],generation_requirements:{provider:'replicate',model:'alibaba/wan-3',profile:'STANDARD',capability:'IMAGE_TO_VIDEO',aspect_ratio:'9:16',resolution:'720p',target_clip_duration_ms:5000,v210_reference:{policy:'PREVIOUS_SHOT_FRAME',previousAssetId:previous}}};}
function normalizer(before,after=before,applied=false){return{async probe(){return before;},async normalize({bytes}){return{bytes:applied?Buffer.from('normalized'):bytes,contentType:'image/jpeg',before,after,normalizationApplied:applied,normalizationVersion:'test-v1',policy:applied?'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD':'NONE_ALREADY_COMPATIBLE'};}};}
function fakeDelegate(row){return{repository:{async get(){return row;}},artifactService:{},mediaInspector:{},assetRepository:{},selection(){return{};},identities(){return{};},async execute({asset:input}){return input;},async loadExisting(){throw new Error('unexpected');}};}
function qualityFrame(i){return{ratio:i/6,timestampMs:i*700,analysisHash:`f${i}`,jpeg:Buffer.from(`f${i}`),differenceFromPrevious:i?8:null,metrics:{mean:100,standardDeviation:30,darkRatio:0,rowDarkRatios:Array(90).fill(0),columnDarkRatios:Array(160).fill(0)}};}

async function main(){
  const t2v=buildWan3Input({prompt:'portrait ad',aspectRatio:'9:16',duration:5});
  assert.equal(t2v.aspect_ratio,'9:16');
  const i2v=buildWan3Input({prompt:'portrait continuation',aspectRatio:'9:16',duration:5,image:'data:image/jpeg;base64,AA=='});
  assert.equal('aspect_ratio'in i2v,false,'Wan 3 image input must inherit framing from image');
  const verifiedBytes=Buffer.from('verified-reference');const verifiedUri=`data:image/jpeg;base64,${verifiedBytes.toString('base64')}`;
  assert.doesNotThrow(()=>assertWan3ReferenceGeometry({capability:'IMAGE_TO_VIDEO',referenceGeometry:{referenceWidth:720,referenceHeight:1280,referenceAspectRatio:.5625,expectedAspectRatio:'9:16',referenceHash:sha(verifiedBytes)}},{firstFrame:verifiedUri},'9:16'));
  assert.throws(()=>assertWan3ReferenceGeometry({capability:'IMAGE_TO_VIDEO'},{firstFrame:'x'},'9:16'),e=>e.code==='REFERENCE_GEOMETRY_MISMATCH');
  assert.throws(()=>assertWan3ReferenceGeometry({capability:'IMAGE_TO_VIDEO',referenceGeometry:{referenceWidth:720,height:1280,referenceHeight:1280,referenceAspectRatio:.5625,expectedAspectRatio:'9:16',referenceHash:sha(Buffer.from('different'))}},{firstFrame:verifiedUri},'9:16'),e=>e.code==='REFERENCE_GEOMETRY_MISMATCH');

  const landscapeJpeg=(await runProcess('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'])).stdout;
  const localNormalized=await new FfmpegReferenceGeometryNormalizer().normalize({bytes:landscapeJpeg,
    contentType:'image/jpeg',expectedAspectRatio:'9:16',resolution:'720p'});
  assert.equal(localNormalized.normalizationApplied,true);assert.equal(localNormalized.after.width,720);
  assert.equal(localNormalized.after.height,1280);assert.equal(localNormalized.policy,'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD');

  const video=Buffer.from('previous-video'),jpeg=Buffer.from('portrait-jpeg');
  const row={status:'SUCCEEDED',artifact_id:'artifact-a1',artifact_version:1,artifact_storage_key:'a1.mp4',artifact_content_hash:sha(video),content_type:'video/mp4',duration_ms:5000,media_probe:{durationMs:5000,width:720,height:1280}};
  const executor=new V210ReferenceAwareMediaExecutor({delegate:fakeDelegate(row),storage:{async get(){return video;}},frameSampler:{async sample(){return[{jpeg,timestampMs:4900,analysisHash:'frame'}];}},geometryNormalizer:normalizer(portrait)});
  const verified=await executor.materializeAsset({workspaceId:W,brandId:B,productionId:P,asset:asset()});
  assert.equal(verified.generation_requirements.v210_reference_evidence.orientation,'PORTRAIT');
  assert.equal(verified.generation_requirements.v210_reference_evidence.normalizationApplied,false);

  const normalizedExecutor=new V210ReferenceAwareMediaExecutor({delegate:fakeDelegate(row),storage:{async get(){return video;}},frameSampler:{async sample(){return[{jpeg,timestampMs:4900,analysisHash:'frame'}];}},geometryNormalizer:normalizer(landscape,portrait,true)});
  const normalized=await normalizedExecutor.materializeAsset({workspaceId:W,brandId:B,productionId:P,asset:asset()});
  assert.equal(normalized.generation_requirements.v210_reference_evidence.normalizationApplied,true);
  assert.equal(normalized.generation_requirements.v210_reference_evidence.referenceHash,sha(Buffer.from('normalized')));

  let calls=0;
  const rejected=new V210ReferenceAwareMediaExecutor({delegate:{...fakeDelegate(row),async execute(){calls+=1;}},storage:{async get(){return video;}},frameSampler:{async sample(){return[{jpeg,timestampMs:4900,analysisHash:'frame'}];}},geometryNormalizer:{async normalize(){throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH','unsafe');},async probe(){return landscape;}}});
  await assert.rejects(()=>rejected.execute({workspaceId:W,brandId:B,productionId:P,workerId:'w',asset:asset()}),{code:'REFERENCE_GEOMETRY_MISMATCH'});
  assert.equal(calls,0,'reference failure occurs before provider boundary');
  const uploadedBytes=Buffer.from('uploaded-landscape');const uploadedAsset=asset('uploaded','a1');
  uploadedAsset.generation_requirements.v210_reference={policy:'UPLOADED_REFERENCE',artifact:{artifactId:'upload-1',version:1,storageKey:'upload.jpg',contentHash:sha(uploadedBytes),contentType:'image/jpeg'}};
  const uploadedExecutor=new V210ReferenceAwareMediaExecutor({delegate:{...fakeDelegate(row),async execute(){calls+=1;}},
    storage:{async get(){return uploadedBytes;}},geometryNormalizer:{async probe(){return landscape;},async normalize(){throw new Error('uploaded references are verify-only');}}});
  await assert.rejects(()=>uploadedExecutor.execute({workspaceId:W,brandId:B,productionId:P,workerId:'w',asset:uploadedAsset}),{code:'REFERENCE_GEOMETRY_MISMATCH'});
  assert.equal(calls,0,'mismatched uploaded reference is rejected without crop or provider call');
  await assert.rejects(()=>executor.validateProviderOutput({asset:verified,media:{provider:'replicate',model:'alibaba/wan-3',requestId:'p1'},probe:{width:1280,height:720}}),e=>e.code==='PROVIDER_OUTPUT_GEOMETRY_MISMATCH'&&e.details.referenceHash===sha(jpeg));

  let semanticCalls=0;
  const evaluator=new VisualQualityEvaluator({frameSampler:{async sample(){return Array.from({length:7},(_,i)=>qualityFrame(i));}},semanticAdapter:{provider:'mock',model:'mock',configured:true,async evaluate(){semanticCalls+=1;}}});
  const result=await evaluator.evaluate({media:{bytes:Buffer.from('landscape'),contentType:'video/mp4',mediaProbe:{width:1280,height:720,durationMs:5000}},expectedAspectRatio:'9:16'});
  assert.equal(result.status,'FAIL');assert.equal(semanticCalls,0);assert.equal(result.semantic.metadata.skipReason,'NOT_EVALUATED_DUE_TO_DETERMINISTIC_BLOCK');

  const check={code:'WRONG_ORIENTATION',status:'FAIL',hardFailure:true,evidence:{width:1280,height:720,expectedAspectRatio:'9:16'}};
  const production={id:P,brandId:B,jobStatus:'FAILED',jobError:{code:'SOURCE_QUALITY_VALIDATION_FAILED',details:{sourceQuality:{shots:[{assetId:'a2',status:'FAIL',sourceProbe:{width:1280,height:720},deterministicVisual:{status:'FAIL',checks:[check]}}]}}},jobPayload:{canonicalRawInput:{aspect_ratio:'9:16',scenes:[{shots:[{shot_id:'s2',asset_id:'a2'}]}]}}};
  let attempts=0;
  const repository={async countGeometryRecoveries(){return attempts;},async latestSuccessfulGeometryRecovery(){return null;}};
  const recovery=new QualityRecoveryService({repository,storage:{},commandService:{},semanticAdapterFactory:()=>{throw new Error('must not instantiate semantic adapter');}});
  const plan=await recovery.inspect({productionId:P,brandId:B,production});
  assert.equal(plan.action,'REGENERATE_SHOT');assert.equal(plan.videoRegenerations,1);assert.equal(plan.semanticEvaluations,1);
  attempts=1;const bounded=await recovery.inspect({productionId:P,brandId:B,production});
  assert.equal(bounded.eligible,false);assert.equal(bounded.automaticGeometryAttemptsMaximum,1);
  attempts=0;
  const directOutputFailure={...production,jobError:{code:'PROVIDER_OUTPUT_GEOMETRY_MISMATCH',details:{assetId:'a2',requestedAspectRatio:'9:16',actualWidth:1280,actualHeight:720}}};
  const directPlan=await recovery.inspect({productionId:P,brandId:B,production:directOutputFailure});
  assert.equal(directPlan.action,'REGENERATE_SHOT','typed provider output mismatch uses shot replacement, never byte re-evaluation');
  const continuation=await recovery.inspect({productionId:P,brandId:B,production:{...production,jobStatus:'RETRYING',
    jobPayload:{...production.jobPayload,geometryRecovery:{status:'SUCCEEDED',sourceAssetId:'a2',replacementAssetId:'a2-v2'}}}});
  assert.equal(continuation.action,'CONTINUE_SAME_EXECUTION');assert.equal(continuation.recoveryKind,'SOURCE_GEOMETRY');

  const replacementAsset=asset('a2-rev-111111111111');replacementAsset.generation_requirements.supersedes_asset_id='a2';
  const input={workspaceId:W,brandId:B,aspectRatio:'9:16',creativePlan:{},visualStyle:{avoid:[]},assetPlan:{assets:[{...asset('a1'),kind:'video'},replacementAsset,{...asset('a3'),kind:'video'},{asset_id:'voice',kind:'voice'}]}};
  let scheduled,executed=[],completed;
  const command=new ProductionCommandService({repository:{db:{},async claimShotRegeneration(){return{id:'r'};},async completeGeometryRecovery(id,value){completed=value;},async failShotRegeneration(){throw new Error('unexpected');}},storage:{},scheduler:(task)=>{scheduled=task;}});
  const runtime={config:{workerId:'worker'},service:{async prepareRevision(){return{input};}},mediaExecutor:{async execute({asset:target}){executed.push(target.asset_id);return{artifact:{artifactId:'a2',version:2,storageKey:'v2',contentHash:'h2'},provider:'replicate',model:'alibaba/wan-3',requestId:'prediction-v2',mediaProbe:{width:720,height:1280},provenance:{}};}},visualQualityEvaluator:{async evaluate(){return{status:'PASS',disposition:'ACCEPT'};}}};
  command.scheduleGeometryRecoveryExecution({record:{id:'r',status:'PREPARED',replacement_asset_id:replacementAsset.asset_id,retry_reason:'WRONG_ORIENTATION'},input,args:{productionId:P,brandId:B,shotId:'s2',sourceJobId:'job-1'},reused:false,revision:{sourceAssetId:'a2',replacementAssetId:replacementAsset.asset_id,revisionNo:1},runtime});
  await scheduled();assert.deepEqual(executed,[replacementAsset.asset_id],'only failed shot is regenerated');assert.equal(completed.result.automaticAttempt,1);
  assert.equal(completed.jobId,'job-1','the exact failed job is resumed');

  const identityExecutor=new DurableMediaExecutor({repository:{},providerGateway:{},artifactService:{},mediaInspector:{}});
  const originalIdentity=identityExecutor.identities({brandId:B,productionId:P,asset:asset('a2','a1')});
  const replacementIdentity=identityExecutor.identities({brandId:B,productionId:P,asset:replacementAsset});
  assert.notEqual(replacementIdentity.idempotencyKey,originalIdentity.idempotencyKey,'replacement gets a new durable provider identity');

  const v2=Buffer.from('successful-v2'),replacementRow={id:'me2',status:'SUCCEEDED',source_asset_id:'a2',replacement_asset_id:replacementAsset.asset_id,revision_no:1,retry_reason:'WRONG_ORIENTATION',artifact_id:'artifact-a2',artifact_version:2,artifact_storage_key:'a2-v2.mp4',artifact_content_hash:sha(v2),content_type:'video/mp4',media_probe:{width:720,height:1280},provider:'replicate',model:'alibaba/wan-3'};
  const lineageDelegate=fakeDelegate(row);lineageDelegate.repository.latestSucceededReplacement=async({assetId})=>assetId==='a2'?replacementRow:null;
  const lineage=new V210ReferenceAwareMediaExecutor({delegate:lineageDelegate,storage:{async get({key}){return key==='a2-v2.mp4'?v2:video;}},frameSampler:{async sample({bytes}){assert.equal(sha(bytes),sha(v2));return[{jpeg,timestampMs:4900,analysisHash:'v2'}];}},geometryNormalizer:normalizer(portrait)});
  const shot3=await lineage.materializeAsset({workspaceId:W,brandId:B,productionId:P,asset:asset('a3','a2')});
  assert.equal(shot3.generation_requirements.v210_reference_evidence.resolvedPreviousAssetId,replacementAsset.asset_id);assert.equal(shot3.generation_requirements.v210_reference_evidence.sourceArtifactVersion,2);
  assert.equal(compatible(geometry(720,1280),'9:16'),true);
  console.log('V2.10.2 reference geometry and bounded recovery tests passed; real external calls = 0');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
