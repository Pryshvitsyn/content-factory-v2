'use strict';
const assert = require('node:assert/strict');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { resolveAuthoritativeVideo, buildCanonicalV210Input } = require('../src/v2.10/runtime-integration');
const { V210IntegratedProductionStarter } = require('../src/v2.10/integrated-starter');
const { bindApprovedKeyframe } = require('../src/v2.10/locked-keyframe-contract');
const { fromAsset } = require('../src/v2.8/canonical-media-request');
const { ReplicateUniversalVideoAdapter, buildSeedance25Input } = require('../src/providers/replicate-universal-video-adapter');
const { buildFfmpegArgs } = require('../src/v2.1/ffmpeg-master-renderer');
const { validateMediaProbe } = require('../src/v2.5/media-validator');

async function main() {
  const catalog = new ProviderCatalog({env:{REPLICATE_API_TOKEN:'synthetic',LUMA_API_KEY:'synthetic'}});
  const selection = durationSeconds => catalog.resolveSelection({provider:'replicate',model:'bytedance/seedance-2.5',profile:'STANDARD',durationSeconds});
  for (const [editorial,provider] of [[3.75,4],[4,4],[4.2,5],[29.9,30]]) {
    const settings=selection(editorial).resolvedSettings;
    assert.equal(settings.editorialDurationSeconds,editorial);assert.equal(settings.providerDurationSeconds,provider);
  }
  assert.throws(()=>selection(30.01),e=>e.code==='UNSUPPORTED_DURATION'&&e.status===409);
  assert.equal(catalog.resolveSelection({provider:'luma',model:'ray-2',profile:'STANDARD',durationSeconds:5.2}).resolvedSettings.providerDurationSeconds,9);
  assert.throws(()=>catalog.resolveSelection({provider:'luma',model:'ray-2',profile:'STANDARD',durationSeconds:9.1}),e=>e.code==='UNSUPPORTED_DURATION');
  assert.throws(()=>buildSeedance25Input({prompt:'Synthetic scene',duration:3.75}),e=>e.code==='UNSUPPORTED_DURATION'&&e.status===409);
  const keyframe={id:'keyframe-1',version:1,content_hash:'immutable-hash',storage_key:'scoped/image.png',content_type:'image/png',
    width:864,height:1536,validation_status:'PASS',approval_decision:'APPROVED',production_id:'production-1',shot_id:'s1',asset_id:'a1'};
  const original={title:'Synthetic timing test',objective:'Show craft',targetPlatform:'Reels',targetDurationSeconds:8,
    hook:'Opening',coreMessage:'Craft',cta:'Visit',creativeConcept:'Synthetic room transformation',visualStyle:'Realistic craft',storyboard:[2.3,5.7].map((durationSeconds,index)=>({shotId:`s${index+1}`,assetId:`a${index+1}`,
      durationSeconds,subject:'A synthetic room',action:'Camera moves through room',environment:'A synthetic apartment',purpose:'Show professional craft',framing:'Vertical room view',camera:'Slow controlled push',continuity:'Same room',roles:index?['RESOLUTION','CTA']:['HOOK']})),voice:{},continuity:{},postProduction:{}};
  const brief=bindApprovedKeyframe(original,'s1',keyframe);
  const before=JSON.stringify({brief,keyframe});
  const video=await resolveAuthoritativeVideo({catalog,workspaceId:'workspace-1',request:{provider:'replicate',model:'bytedance/seedance-2.5',profile:'STANDARD',resolution:'720p'},brief});
  assert.deepEqual(video.shotCapabilities.map(s=>s.resolvedSettings.providerDurationSeconds),[4,6]);
  const draft={id:'draft-1',brand_id:'21000000-0000-4000-8000-000000000011',workspace_id:'workspace-1',revision:1,creative_brief:brief};
  const canonical=buildCanonicalV210Input({draft,preflight:{authoritativeVideo:video}});
  const assets=canonical.input.assetPlan.assets.filter(a=>a.kind==='video');
  assert.deepEqual(assets.map(a=>a.generation_requirements.target_clip_duration_ms),[2300,5700]);
  assert.deepEqual(assets.map(a=>a.generation_requirements.resolved_settings.providerDurationSeconds),[4,6]);
  assert.equal(canonical.input.targetDurationSeconds,8);assert.equal(JSON.stringify({brief,keyframe}),before);
  const starter=Object.create(V210IntegratedProductionStarter.prototype);
  starter.env={};starter.runtime=()=>({mediaExecutor:{selection:()=>({provider:'replicate',model:'bytedance/seedance-2.5'})}});
  const bounded=await starter.preflightLockedFirstVideo({draft,preflight:{authoritativeVideo:video},keyframe});
  assert.equal(bounded.providerExecutions,0);assert.equal(bounded.plan.editorialDurationSeconds,2.3);assert.equal(bounded.plan.providerDurationSeconds,4);
  assert.equal(bounded.plan.externalCalls.video,1);assert.equal(bounded.plan.externalCalls.semanticVideoEvaluation,1);assert.equal(bounded.plan.externalCalls.maximum,2);
  const adapter=new ReplicateUniversalVideoAdapter({family:'SEEDANCE_2_5',model:'bytedance/seedance-2.5',apiToken:'synthetic'});
  let submitted;adapter.runPrediction=async({input})=>{submitted=input;return{provenance:{}}};
  await adapter.generate({canonicalRequest:fromAsset(assets[0])});assert.equal(submitted.duration,4);
  const args=buildFfmpegArgs({assembly:{durationMs:8000,clips:[{kind:'video',durationMs:2300},{kind:'video',durationMs:5700}]},inputPaths:['synthetic-a.mp4','synthetic-b.mp4'],outputPath:'synthetic-master.mp4'});
  assert(args.join(' ').includes('trim=start=0.000:duration=2.300'));assert(args.join(' ').includes('trim=start=0.000:duration=5.700'));
  const probe={size:10,videoCodec:'h264',durationMs:4000};assert.equal(validateMediaProbe({kind:'video',probe,expectedDurationMs:2300}).status,'PASS');
  assert.throws(()=>validateMediaProbe({kind:'video',probe:{...probe,durationMs:700},expectedDurationMs:2300}),e=>e.code==='MEDIA_DURATION_TOO_SHORT');
  console.log('Per-shot provider duration resolution, exact editorial timing, bounded preflight, adapter mapping and deterministic trim: PASS; real provider calls 0');
}
main().catch(e=>{console.error(e);process.exitCode=1});
