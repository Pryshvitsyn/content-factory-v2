'use strict';

const crypto=require('node:crypto');

class VideoModelContractError extends Error {
  constructor(code,message,details=null){super(message);this.name='VideoModelContractError';this.code=code;this.status=409;this.details=details;}
}

const INPUT_MODES=Object.freeze({
  TEXT_TO_VIDEO:'TEXT_TO_VIDEO',FIRST_FRAME_IMAGE_TO_VIDEO:'FIRST_FRAME_IMAGE_TO_VIDEO',
  FIRST_LAST_FRAME:'FIRST_LAST_FRAME',MULTIMODAL_REFERENCE:'MULTIMODAL_REFERENCE',
  VIDEO_EDITING:'VIDEO_EDITING',VIDEO_EXTENSION:'VIDEO_EXTENSION',
});
const REGISTRY=new Map();
function key(provider,model){return `${String(provider).toLowerCase()}:${model}`;}
function deepFreeze(value){if(ArrayBuffer.isView(value))return value;if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}
function immutable(value){return deepFreeze(structuredClone(value));}
function stable(value){if(Buffer.isBuffer(value))return {byteSize:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex')};if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){const entries=Object.entries(value).filter(([name])=>!(name==='providerValue'&&value.sha256));return Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=>[name,stable(child)]));}return value;}
function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function registerVideoModelContract(contract){
  if(!contract?.provider||!contract?.model||!contract?.contractVersion||typeof contract.mapRequest!=='function'||typeof contract.validate!=='function')throw new Error('A complete video model contract is required');
  const id=key(contract.provider,contract.model);if(REGISTRY.has(id))throw new Error(`Video model contract already registered: ${id}`);
  const frozen=Object.freeze({...contract,providerFields:immutable(contract.providerFields||[]),providerSchema:immutable(contract.providerSchema||{}),inputModes:immutable(contract.inputModes),capabilities:immutable(contract.capabilities),parameters:immutable(contract.parameters),limits:immutable(contract.limits),provenance:immutable(contract.provenance),output:immutable(contract.output||{}),pricing:immutable(contract.pricing||{}),technicalQa:immutable(contract.technicalQa),workflowCompatibility:immutable(contract.workflowCompatibility)});
  REGISTRY.set(id,frozen);return frozen;
}
function getVideoModelContract(provider,model){return REGISTRY.get(key(provider,model))||null;}
function listVideoModelContracts(){return [...REGISTRY.values()];}
function compareVideoModelSchema({provider,model,schema}={}){const contract=getVideoModelContract(provider,model);if(!contract)fail('VIDEO_MODEL_CONTRACT_NOT_FOUND',`No reviewed video model contract for ${provider}/${model}`);const root=schema?.input||schema||{},properties=root.properties||{},actual=Object.keys(properties).sort(),reviewed=[...(contract.providerFields||[])].sort(),added=actual.filter(x=>!reviewed.includes(x)),removed=reviewed.filter(x=>!actual.includes(x)),required=new Set(root.required||[]),changed=[];for(const field of actual.filter(x=>reviewed.includes(x))){const expected=contract.providerSchema[field];if(!expected)continue;const observed=properties[field]||{};for(const attribute of ['type','default'])if(Object.hasOwn(expected,attribute)&&JSON.stringify(expected[attribute])!==JSON.stringify(observed[attribute]))changed.push({field,attribute,expected:expected[attribute],actual:observed[attribute]});if(expected.enum&&JSON.stringify([...expected.enum].sort())!==JSON.stringify([...(observed.enum||[])].sort()))changed.push({field,attribute:'enum',expected:expected.enum,actual:observed.enum||null});if(Boolean(expected.required)!==required.has(field))changed.push({field,attribute:'required',expected:Boolean(expected.required),actual:required.has(field)});for(const attribute of ['minimum','maximum'])if(Object.hasOwn(expected,attribute)&&expected[attribute]!==observed[attribute])changed.push({field,attribute,expected:expected[attribute],actual:observed[attribute]});}return Object.freeze({status:added.length||removed.length||changed.length?'SCHEMA_DRIFT':'CURRENT',provider,model,contractVersion:contract.contractVersion,added,removed,changed});}
function valueOf(item){return item&&typeof item==='object'&&Object.hasOwn(item,'providerValue')?item.providerValue:item;}
function durationOf(item){return Number(item?.durationSeconds??item?.duration??0);}
function ensureArray(value){return Array.isArray(value)?value:[];}
function fail(code,message,details){throw new VideoModelContractError(code,message,details);}

const SEEDANCE_ALLOWED=new Set(['resolvedInputMode','prompt','image','lastFrameImage','referenceImages','referenceVideos','referenceAudios','duration','resolution','aspectRatio','generateAudio','watermark','outputFormat','seed']);
function validateSeedance(request){
  const unknown=Object.keys(request).filter((field)=>!SEEDANCE_ALLOWED.has(field));if(unknown.length)fail('UNSUPPORTED_MODEL_PARAMETER',`Unsupported Seedance 2.5 parameter(s): ${unknown.join(', ')}`,{fields:unknown});
  if(String(request.prompt||'').length>2000)fail('SEEDANCE_PROMPT_TOO_LONG','Seedance 2.5 prompt exceeds 2000 characters');
  if(!Object.values(INPUT_MODES).includes(request.resolvedInputMode))fail('SEEDANCE_INPUT_MODE_REQUIRED','An explicit supported resolvedInputMode is required');
  const images=ensureArray(request.referenceImages),videos=ensureArray(request.referenceVideos),audios=ensureArray(request.referenceAudios),hasMulti=images.length||videos.length||audios.length;
  if((request.image||request.lastFrameImage)&&hasMulti)fail('SEEDANCE_INPUT_MODE_CONFLICT','First/last frames cannot be combined with multimodal references');
  if(request.lastFrameImage&&!request.image)fail('LAST_FRAME_REQUIRES_FIRST_FRAME','lastFrameImage requires image');
  if(audios.length&&!images.length&&!videos.length)fail('REFERENCE_AUDIO_REQUIRES_VISUAL_REFERENCE','Reference audio requires at least one reference image or video');
  if(images.length>30)fail('REFERENCE_IMAGE_LIMIT_EXCEEDED','Seedance 2.5 accepts at most 30 reference images');
  if(videos.length>10)fail('REFERENCE_VIDEO_LIMIT_EXCEEDED','Seedance 2.5 accepts at most 10 reference videos');
  if(audios.length>10)fail('REFERENCE_AUDIO_LIMIT_EXCEEDED','Seedance 2.5 accepts at most 10 reference audios');
  if(videos.reduce((n,x)=>n+durationOf(x),0)>30)fail('REFERENCE_VIDEO_DURATION_LIMIT_EXCEEDED','Combined reference video duration exceeds 30 seconds');
  if(audios.reduce((n,x)=>n+durationOf(x),0)>30)fail('REFERENCE_AUDIO_DURATION_LIMIT_EXCEEDED','Combined reference audio duration exceeds 30 seconds');
  const mode=request.resolvedInputMode;
  if(mode===INPUT_MODES.TEXT_TO_VIDEO&&(request.image||request.lastFrameImage||hasMulti))fail('SEEDANCE_INPUT_MODE_CONFLICT','TEXT_TO_VIDEO cannot include media');
  if(mode===INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO&&(!request.image||request.lastFrameImage||hasMulti))fail(request.image?'SEEDANCE_INPUT_MODE_CONFLICT':'FIRST_FRAME_REQUIRED','FIRST_FRAME_IMAGE_TO_VIDEO requires exactly one first frame');
  if(mode===INPUT_MODES.FIRST_LAST_FRAME&&(!request.image||!request.lastFrameImage||hasMulti))fail(!request.image?'LAST_FRAME_REQUIRES_FIRST_FRAME':'SEEDANCE_INPUT_MODE_CONFLICT','FIRST_LAST_FRAME requires first and last frames only');
  if([INPUT_MODES.MULTIMODAL_REFERENCE,INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(mode)&&(!hasMulti||request.image||request.lastFrameImage))fail('SEEDANCE_INPUT_MODE_CONFLICT',`${mode} requires multimodal references and no first/last frame`);
  if([INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(mode)&&!videos.length)fail('SEEDANCE_INPUT_MODE_CONFLICT',`${mode} requires a reference video`);
  const duration=Number(request.duration);if(duration!==-1&&(!Number.isInteger(duration)||duration<4||duration>30))fail('INVALID_DURATION','Seedance duration must be -1 or 4-30 seconds');
  if([INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(mode)&&duration!==-1)fail('INVALID_DURATION','Editing and extension require intelligent duration (-1)');
  if(!['480p','720p','1080p'].includes(request.resolution))fail('UNSUPPORTED_RESOLUTION','Unsupported Seedance 2.5 resolution');
  if(!['adaptive','16:9','9:16','1:1','4:3','3:4'].includes(request.aspectRatio))fail('UNSUPPORTED_ASPECT_RATIO','Unsupported Seedance 2.5 aspect ratio');
  if([INPUT_MODES.FIRST_LAST_FRAME,INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(mode)&&request.aspectRatio!=='adaptive')fail('UNSUPPORTED_ASPECT_RATIO',`${mode} requires adaptive aspect ratio`);
  if(request.outputFormat!=='mp4')fail('UNSUPPORTED_OUTPUT_FORMAT','Reviewed Seedance 2.5 contract permits mp4 output only');
  if(request.seed!=null&&(!Number.isInteger(request.seed)||request.seed<0))fail('CANONICAL_SEED_INVALID','seed must be a non-negative integer');
  if(!String(request.prompt||'').trim()&&!request.image&&!hasMulti)fail('CANONICAL_PROMPT_REQUIRED','Prompt or media input is required');
}

const SEEDANCE_25=registerVideoModelContract({
  provider:'replicate',model:'bytedance/seedance-2.5',displayName:'Seedance 2.5',mediaType:'VIDEO',contractVersion:'replicate-seedance-2.5@1',
  providerFields:['prompt','image','last_frame_image','reference_images','reference_videos','reference_audios','duration','resolution','aspect_ratio','generate_audio','watermark','output_format','seed'],
  providerSchema:{prompt:{type:'string',required:false},image:{type:'string',required:false},last_frame_image:{type:'string',required:false},reference_images:{type:'array',required:false},reference_videos:{type:'array',required:false},reference_audios:{type:'array',required:false},duration:{type:'integer',minimum:-1,maximum:30,default:5,required:false},resolution:{type:'string',enum:['480p','720p','1080p'],default:'720p',required:false},aspect_ratio:{type:'string',enum:['adaptive','16:9','9:16','1:1','4:3','3:4'],default:'16:9',required:false},generate_audio:{type:'boolean',default:true,required:false},watermark:{type:'boolean',default:false,required:false},output_format:{type:'string',enum:['mp4'],default:'mp4',required:false},seed:{type:'integer',minimum:0,required:false}},
  provenance:{source:'https://replicate.com/bytedance/seedance-2.5/versions/fa8b2706824084e968dfe1d1cdff8e0193b40ef908827e3d2940a927704a5f43/api',observedAt:'2026-09-05',providerSchemaVersion:'fa8b2706824084e968dfe1d1cdff8e0193b40ef908827e3d2940a927704a5f43'},
  inputModes:Object.values(INPUT_MODES),capabilities:['TEXT_TO_VIDEO','FIRST_FRAME_IMAGE_TO_VIDEO','FIRST_LAST_FRAME_VIDEO','MULTIMODAL_REFERENCE','REFERENCE_IMAGE','REFERENCE_VIDEO','REFERENCE_AUDIO','VIDEO_EDITING','VIDEO_EXTENSION','NATIVE_AUDIO_GENERATION','SEED_CONTROL','ADAPTIVE_ASPECT_RATIO','VIDEO_OUTPUT'],
  parameters:{duration:{type:'integer',values:{intelligent:-1,minimum:4,maximum:30},providerDefault:5,contentFactoryDefault:5},resolution:{type:'enum',values:['480p','720p','1080p'],providerDefault:'720p',contentFactoryDefault:'720p'},aspectRatio:{type:'enum',values:['adaptive','16:9','9:16','1:1','4:3','3:4'],providerDefault:'16:9',contentFactoryDefault:'16:9'},generateAudio:{type:'boolean',providerDefault:true,contentFactoryDefault:false},watermark:{type:'boolean',providerDefault:false,contentFactoryDefault:false},outputFormat:{type:'enum',values:['mp4'],providerDefault:'mp4',contentFactoryDefault:'mp4'},seed:{type:'integer',optional:true}},
  limits:{referenceImages:30,referenceVideos:10,referenceAudios:10,combinedReferenceVideoSeconds:30,combinedReferenceAudioSeconds:30,promptCharacters:2000},
  output:{type:'uri',mediaType:'video/mp4'},pricing:{status:'UNKNOWN_CURRENT_PRICE',unit:'OUTPUT_SECOND'},resolverStrategy:'REPLICATE_SDK_LOCAL_FILE',technicalQa:{profile:'BASE_VIDEO_QA',expectedContainer:'mp4'},workflowCompatibility:{profiles:['BASE_VIDEO_QA','AVATAR_MOTION_QA','LOOP_CONTENT_QA','AUDIO_VIDEO_QA']},
  validate:validateSeedance,
  mapRequest(request){validateSeedance(request);return Object.freeze({...(String(request.prompt||'').trim()?{prompt:request.prompt.trim()}:{}),duration:request.duration,resolution:request.resolution,aspect_ratio:request.aspectRatio,generate_audio:request.generateAudio,watermark:request.watermark,output_format:request.outputFormat,...(request.seed==null?{}:{seed:request.seed}),...(request.image?{image:valueOf(request.image)}:{}),...(request.lastFrameImage?{last_frame_image:valueOf(request.lastFrameImage)}:{}),...(request.referenceImages?.length?{reference_images:request.referenceImages.map(valueOf)}:{}),...(request.referenceVideos?.length?{reference_videos:request.referenceVideos.map(valueOf)}:{}),...(request.referenceAudios?.length?{reference_audios:request.referenceAudios.map(valueOf)}:{})});},
});

function resolveVideoModelRequest({provider,model,request={}}={}){
  const contract=getVideoModelContract(provider,model);if(!contract)fail('VIDEO_MODEL_CONTRACT_NOT_FOUND',`No reviewed video model contract for ${provider}/${model}`);
  const resolved={...request,duration:request.duration??contract.parameters.duration.contentFactoryDefault,resolution:request.resolution??contract.parameters.resolution.contentFactoryDefault,aspectRatio:request.aspectRatio??contract.parameters.aspectRatio.contentFactoryDefault,generateAudio:request.generateAudio??contract.parameters.generateAudio.contentFactoryDefault,watermark:request.watermark??contract.parameters.watermark.contentFactoryDefault,outputFormat:request.outputFormat??contract.parameters.outputFormat.contentFactoryDefault,referenceImages:ensureArray(request.referenceImages),referenceVideos:ensureArray(request.referenceVideos),referenceAudios:ensureArray(request.referenceAudios)};
  contract.validate(resolved);const providerInput=contract.mapRequest(resolved);const snapshot=immutable({schemaVersion:'video-model-request@1',provider:contract.provider,model:contract.model,modelContractVersion:contract.contractVersion,providerSchemaVersion:contract.provenance.providerSchemaVersion,resolvedInputMode:resolved.resolvedInputMode,resolvedRequest:resolved,providerInput,expectedProviderCalls:1,pricing:contract.pricing});
  const fingerprintSnapshot={...snapshot,providerInput:Object.keys(providerInput).sort()};
  return Object.freeze({...snapshot,requestFingerprint:fingerprint(fingerprintSnapshot)});
}

module.exports={INPUT_MODES,SEEDANCE_25,VideoModelContractError,registerVideoModelContract,getVideoModelContract,listVideoModelContracts,compareVideoModelSchema,resolveVideoModelRequest,fingerprint};
