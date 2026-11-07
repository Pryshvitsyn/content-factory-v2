'use strict';
const assert=require('node:assert/strict');
const {createCanonicalMediaRequest}=require('../src/v2.8/canonical-media-request');
const compiler=require('../src/v2.8/provider-request-compiler');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
function req(provider,model,extra={}){return createCanonicalMediaRequest({capability:'TEXT_TO_VIDEO',prompt:'A quiet kitchen.',providerPrompt:'A quiet kitchen.',providerSelection:{provider,model,profile:'STANDARD'},resolution:'720p',aspectRatio:'9:16',durationSeconds:5,...extra});}
function blocked(fn,code){assert.throws(fn,e=>e.code===code&&e.boundaryState==='NOT_CROSSED');}
function image(model,extra={}){return compiler.compileAuxiliaryRequest({asset:{description:'A ceramic mug.',generation_requirements:extra},capability:'image-generation',provider:'openai',model});}
check('Runway final UTF16 boundary allows 1000 units and rejects 1002',()=>{
 const at=compiler.compileVideoRequest(req('runway','gen4.5',{providerPrompt:'😀'.repeat(500)}));assert.equal(at.payload.promptText.length,1000);assert.equal(at.summary.promptLengthActual,1000);assert.equal(at.summary.promptLimitUnit,'UTF16_CODE_UNITS');
 blocked(()=>compiler.compileVideoRequest(req('runway','gen4.5',{providerPrompt:'😀'.repeat(501)})),'FINAL_PROMPT_TOO_LONG');
});
check('local Replicate budget remains Unicode code points',()=>{
 const c=compiler.compileVideoRequest(req('replicate','bytedance/seedance-2.5',{providerPrompt:'😀'.repeat(4000)}));assert.equal(c.summary.promptLengthActual,4000);assert.equal(c.payload.input.prompt.length,8000);
 blocked(()=>compiler.compileVideoRequest(req('replicate','bytedance/seedance-2.5',{providerPrompt:'😀'.repeat(4001)})),'FINAL_PROMPT_TOO_LONG');
});
check('Runway rejects unsupported square instead of emitting landscape',()=>{
 blocked(()=>compiler.compileVideoRequest(req('runway','gen4.5',{aspectRatio:'1:1'})),'UNSUPPORTED_ASPECT_RATIO');
 assert.equal(compiler.compileVideoRequest(req('runway','gen4.5')).payload.ratio,'720:1280');
});
check('both fal routes reject adaptive and preserve auto',()=>{
 for(const model of ['bytedance/seedance-2.0/text-to-video','bytedance/seedance-2.5/text-to-video']){
  blocked(()=>compiler.compileVideoRequest(req('fal',model,{aspectRatio:'adaptive'})),'UNSUPPORTED_ASPECT_RATIO');
  assert.equal(compiler.compileVideoRequest(req('fal',model,{aspectRatio:'auto'})).payload.aspect_ratio,'auto');
 }
});
check('frame-based duration agrees with the reviewed timeline',()=>{
 const r=req('replicate','wan-video/wan-2.2-t2v-fast',{resolvedSettings:{numFrames:81,framesPerSecond:16}});
 assert.equal(compiler.compileVideoRequest(r).payload.input.num_frames,81);
 blocked(()=>compiler.compileVideoRequest({...r,durationSeconds:30}),'PROVIDER_DURATION_MISMATCH');
 assert.equal(compiler.compileVideoRequest({...r,resolvedSettings:{numFrames:121,framesPerSecond:24}}).payload.input.num_frames,121);
});
check('legacy image sizes are checked per model',()=>{
 for(const model of ['gpt-image-1-mini','gpt-image-1.5']){
  blocked(()=>image(model,{size:'256x256'}),'UNSUPPORTED_IMAGE_SIZE');
  assert.equal(image(model,{size:'1024x1536'}).payload.size,'1024x1536');
 }
 assert.equal(image('gpt-image-2',{size:'1536x864'}).payload.size,'1536x864');
});
check('higher image qualities stay scoped to verified model families',()=>{
 for(const model of ['gpt-image-1-mini','gpt-image-1.5','gpt-image-2','gpt-image-2-2026-04-21']) blocked(()=>image(model,{quality:'max'}),'UNSUPPORTED_IMAGE_QUALITY');
 assert.equal(image('gpt-image-2.5-sunburst',{quality:'max'}).payload.quality,'max');
 assert.equal(image('gpt-image-2.5-flare-2026-09-08',{quality:'xhigh'}).payload.quality,'xhigh');
});
check('unsupported voice direction fails instead of silently losing intent',()=>{
 const args={asset:{description:'Hello.',generation_requirements:{instructions:'Whisper softly.'}},capability:'speech-generation',provider:'openai'};
 for(const model of ['tts-1','tts-1-hd']) blocked(()=>compiler.compileAuxiliaryRequest({...args,model}),'UNSUPPORTED_SPEECH_INSTRUCTIONS');
 assert.equal(compiler.compileAuxiliaryRequest({...args,model:'gpt-4o-mini-tts'}).payload.instructions,'Whisper softly.');
});
check('older compiler certificates cannot authorize the changed rules',()=>{
 blocked(()=>compiler.compileVideoRequest(req('replicate','bytedance/seedance-2.5',{requestCompilerVersion:'provider-request/3'})),'STALE_PROVIDER_PREFLIGHT');
 const request=req('replicate','bytedance/seedance-2.5');const first=compiler.compileVideoRequest(request);
 assert.equal(compiler.compileVideoRequest({...request,expectedProviderRequest:first.summary}).fingerprint,first.fingerprint);
});
check('collector returns every failing shot including a fourth shot',()=>{
 const assets=Array.from({length:4},(_,i)=>({asset_id:'video-'+(i+1),kind:'video',generation_requirements:{provider:'runway',model:'gen4.5',profile:'STANDARD',prompt:'😀'.repeat(600),prompt_compiler_version:'shot/4',capability:'TEXT_TO_VIDEO',resolution:'720p',aspect_ratio:'9:16',target_clip_duration_ms:5000}}));
 const result=compiler.collectProviderPreflight(assets);assert.equal(result.length,4);assert(result.every(x=>x.status==='BLOCKED'&&x.unit==='UTF16_CODE_UNITS'));
});
console.log(`${count} audit regression groups passed. Provider calls: 0. Database access: 0.`);
