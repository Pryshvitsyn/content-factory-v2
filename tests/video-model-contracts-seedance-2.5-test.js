'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {INPUT_MODES,SEEDANCE_25,getVideoModelContract,registerVideoModelContract,resolveVideoModelRequest,compareVideoModelSchema}=require('../src/v2.8/video-model-contracts');
const {ProviderCatalog}=require('../src/v2.8/provider-catalog');
const {createVideoAdapter}=require('../src/v2.8/provider-adapter-factory');
const {safeInputProvenance}=require('../src/providers/replicate-wan-video-adapter');
const {createCanonicalMediaRequest}=require('../src/v2.8/canonical-media-request');

function code(fn,value){assert.throws(fn,(e)=>e.code===value);}
const base={resolvedInputMode:INPUT_MODES.TEXT_TO_VIDEO,prompt:'A precise production brief',duration:5,resolution:'720p',aspectRatio:'16:9',generateAudio:false,watermark:false,outputFormat:'mp4',seed:42};

test('Seedance 2.5 is a first-class reviewed Replicate model contract',()=>{const contract=getVideoModelContract('replicate','bytedance/seedance-2.5');assert.equal(contract,SEEDANCE_25);assert.equal(contract.contractVersion,'replicate-seedance-2.5@1');assert.equal(contract.provenance.providerSchemaVersion.length,64);const model=new ProviderCatalog({env:{REPLICATE_API_TOKEN:'mock'}}).listModels('replicate').find(x=>x.modelId==='bytedance/seedance-2.5');assert.equal(model.displayName,'Seedance 2.5');assert.equal(model.modelContract.contractVersion,contract.contractVersion);assert(model.modelContract.inputModes.includes('MULTIMODAL_REFERENCE'));});

test('all explicit input modes map exact reviewed fields and defaults',()=>{
  const text=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:base});assert.deepEqual(text.providerInput,{prompt:base.prompt,duration:5,resolution:'720p',aspect_ratio:'16:9',generate_audio:false,watermark:false,output_format:'mp4',seed:42});assert.equal(text.expectedProviderCalls,1);assert.match(text.requestFingerprint,/^[a-f0-9]{64}$/);
  const first=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO,image:'first'}});assert.equal(first.providerInput.image,'first');
  const ends=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:INPUT_MODES.FIRST_LAST_FRAME,image:'first',lastFrameImage:'last',aspectRatio:'adaptive'}});assert.equal(ends.providerInput.last_frame_image,'last');
  const multi=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:[{providerValue:'i',durationSeconds:0}],referenceVideos:[{providerValue:'v',durationSeconds:10}],referenceAudios:[{providerValue:'a',durationSeconds:10}],generateAudio:true}});assert.deepEqual(multi.providerInput.reference_images,['i']);assert.deepEqual(multi.providerInput.reference_videos,['v']);assert.deepEqual(multi.providerInput.reference_audios,['a']);assert.equal(multi.providerInput.generate_audio,true);
  for(const mode of [INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION])assert.equal(resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:mode,referenceVideos:[{providerValue:'v',durationSeconds:20}],duration:-1,aspectRatio:'adaptive'}}).providerInput.duration,-1);
});

test('compatibility, limits, enums and unknown fields fail closed with precise codes',()=>{
  const bad=(patch)=>()=>resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,...patch}});
  code(bad({resolvedInputMode:INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO}),'FIRST_FRAME_REQUIRED');
  code(bad({resolvedInputMode:INPUT_MODES.FIRST_LAST_FRAME,lastFrameImage:'last',aspectRatio:'adaptive'}),'LAST_FRAME_REQUIRES_FIRST_FRAME');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceAudios:[{providerValue:'a',durationSeconds:1}]}),'REFERENCE_AUDIO_REQUIRES_VISUAL_REFERENCE');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,image:'first',referenceImages:['i']}),'SEEDANCE_INPUT_MODE_CONFLICT');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:Array(31).fill('i')}),'REFERENCE_IMAGE_LIMIT_EXCEEDED');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceVideos:Array(11).fill({providerValue:'v',durationSeconds:1})}),'REFERENCE_VIDEO_LIMIT_EXCEEDED');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:['i'],referenceAudios:Array(11).fill({providerValue:'a',durationSeconds:1})}),'REFERENCE_AUDIO_LIMIT_EXCEEDED');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceVideos:[{providerValue:'v',durationSeconds:31}]}),'REFERENCE_VIDEO_DURATION_LIMIT_EXCEEDED');
  code(bad({resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:['i'],referenceAudios:[{providerValue:'a',durationSeconds:31}]}),'REFERENCE_AUDIO_DURATION_LIMIT_EXCEEDED');
  for(const patch of [{duration:3},{resolution:'4k'},{aspectRatio:'cinema'},{outputFormat:'webm'}])code(bad(patch),patch.duration?'INVALID_DURATION':patch.resolution?'UNSUPPORTED_RESOLUTION':patch.aspectRatio?'UNSUPPORTED_ASPECT_RATIO':'UNSUPPORTED_OUTPUT_FORMAT');
  code(bad({fps:24}),'UNSUPPORTED_MODEL_PARAMETER');
  code(()=>createCanonicalMediaRequest({capability:'TEXT_TO_VIDEO',prompt:'legacy',durationSeconds:-1,providerSelection:{provider:'replicate',model:'wan-video/wan-2.2-t2v-fast',profile:'STANDARD'}}),'UNSUPPORTED_DURATION');
});

test('request order changes fingerprint and schema comparison detects material drift without mutation',()=>{const one=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:['a','b']}}),two=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:INPUT_MODES.MULTIMODAL_REFERENCE,referenceImages:['b','a']}});assert.notEqual(one.requestFingerprint,two.requestFingerprint);const properties=structuredClone(SEEDANCE_25.providerSchema);for(const value of Object.values(properties))delete value.required;assert.equal(compareVideoModelSchema({provider:'replicate',model:SEEDANCE_25.model,schema:{properties,required:[]}}).status,'CURRENT');properties.new_field={type:'string'};assert.deepEqual(compareVideoModelSchema({provider:'replicate',model:SEEDANCE_25.model,schema:{properties,required:[]}}).added,['new_field']);delete properties.new_field;properties.duration.type='string';let drift=compareVideoModelSchema({provider:'replicate',model:SEEDANCE_25.model,schema:{properties,required:[]}});assert(drift.changed.some(x=>x.field==='duration'&&x.attribute==='type'));properties.duration.type='integer';properties.resolution.enum=['720p'];drift=compareVideoModelSchema({provider:'replicate',model:SEEDANCE_25.model,schema:{properties,required:['prompt']}});assert(drift.changed.some(x=>x.attribute==='enum'));assert(drift.changed.some(x=>x.attribute==='required'));});

test('future Replicate model registration reaches the same generic adapter path',()=>{const model=`example/future-video-${Date.now()}`;registerVideoModelContract({provider:'replicate',model,contractVersion:'test@1',providerFields:['prompt'],inputModes:['TEXT_TO_VIDEO'],capabilities:['TEXT_TO_VIDEO'],parameters:{},limits:{},provenance:{},technicalQa:{profile:'BASE_VIDEO_QA'},workflowCompatibility:{profiles:['BASE_VIDEO_QA']},validate(){},mapRequest(r){return {prompt:r.prompt};}});const adapter=createVideoAdapter({provider:'replicate',model,adapterFamily:'replicate-video-contract'},{env:{REPLICATE_API_TOKEN:'mock'},fetchImpl:async()=>{throw Error('network forbidden')}});assert.equal(adapter.family,'MODEL_CONTRACT');assert.equal(adapter.modelContract.model,model);});

test('generic Replicate transport sends exact compiled payloads for every reviewed Seedance mode',async()=>{
  const cases=[
    {mode:INPUT_MODES.TEXT_TO_VIDEO,patch:{}},
    {mode:INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO,patch:{image:'data:image/png;base64,Zmlyc3Q='}},
    {mode:INPUT_MODES.FIRST_LAST_FRAME,patch:{image:'data:image/png;base64,Zmlyc3Q=',lastFrameImage:'data:image/png;base64,bGFzdA==',aspectRatio:'adaptive'}},
    {mode:INPUT_MODES.MULTIMODAL_REFERENCE,patch:{referenceImages:[{providerValue:'data:image/png;base64,aW1hZ2U=',durationSeconds:0}],referenceVideos:[{providerValue:'https://fixture.invalid/reference.mp4',durationSeconds:10}],referenceAudios:[{providerValue:'https://fixture.invalid/reference.wav',durationSeconds:10}],generateAudio:true}},
    {mode:INPUT_MODES.VIDEO_EDITING,patch:{referenceVideos:[{providerValue:'https://fixture.invalid/edit.mp4',durationSeconds:20}],duration:-1,aspectRatio:'adaptive'}},
    {mode:INPUT_MODES.VIDEO_EXTENSION,patch:{referenceVideos:[{providerValue:'https://fixture.invalid/extend.mp4',durationSeconds:20}],duration:-1,aspectRatio:'adaptive'}},
  ];
  for(const [index,item] of cases.entries()){
    const calls=[],request=resolveVideoModelRequest({provider:'replicate',model:SEEDANCE_25.model,request:{...base,resolvedInputMode:item.mode,...item.patch}});
    const responses=[{ok:true,status:201,text:async()=>JSON.stringify({id:`seedance-request-${index}`,status:'succeeded',output:'https://replicate.delivery/output.mp4'})},{ok:true,status:200,arrayBuffer:async()=>Uint8Array.from(Buffer.from('fixture-video')).buffer}];
    const adapter=createVideoAdapter({provider:'replicate',model:SEEDANCE_25.model,adapterFamily:'replicate-video-contract'},{env:{REPLICATE_API_TOKEN:'mock-token'},fetchImpl:async(url,options)=>{calls.push({url,options});return responses.shift();},sleep:async()=>{}});
    const canonical={providerPrompt:request.resolvedRequest.prompt,capability:'TEXT_TO_VIDEO',resolvedInputMode:item.mode,resolution:request.resolvedRequest.resolution,aspectRatio:request.resolvedRequest.aspectRatio,durationSeconds:request.resolvedRequest.duration,audio:{requested:request.resolvedRequest.generateAudio},resolvedSettings:{watermark:request.resolvedRequest.watermark,outputFormat:request.resolvedRequest.outputFormat},modelContractRequest:request};
    await adapter.generate({capability:'TEXT_TO_VIDEO',model:SEEDANCE_25.model,canonicalRequest:canonical,idempotencyKey:`exact-request-${index}`});
    const body=JSON.parse(calls[0].options.body);assert.equal(calls[0].options.method,'POST');assert.deepEqual(body.input,request.providerInput);
    assert.deepEqual(Object.keys(body.input).sort(),Object.keys(request.providerInput).sort());
    for(const field of ['negative_prompt','shot_type','enable_prompt_expansion','num_frames','frames_per_second','go_fast'])assert.equal(field in body.input,false);
  }
});

test('Replicate provenance retains media evidence without raw URLs or base64',()=>{const input={prompt:'safe',image:'data:image/png;base64,Zmlyc3Q=',reference_videos:['https://private.invalid/reference.mp4']};const evidence=safeInputProvenance(input);assert.equal(evidence.prompt,'safe');assert.equal(evidence.image.kind,'DATA_URI');assert.equal(evidence.image.byteSize,5);assert.match(evidence.image.sha256,/^[a-f0-9]{64}$/);assert.equal(evidence.reference_videos[0].kind,'REMOTE_REFERENCE');assert.match(evidence.reference_videos[0].locatorHash,/^[a-f0-9]{64}$/);const serialized=JSON.stringify(evidence);assert.equal(serialized.includes('base64'),false);assert.equal(serialized.includes('private.invalid'),false);});
