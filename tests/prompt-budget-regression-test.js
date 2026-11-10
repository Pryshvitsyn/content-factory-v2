'use strict';
// Pure compilation/validation regression checks. Never calls a provider or opens a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const repo = path.resolve(process.argv[2] || process.cwd());
const overlay = path.join(__dirname, 'files');
const localFixture = process.argv.includes('--fixture-canonical');
const originalLoad = Module._load;
const files = ['src/v2.8/provider-request-compiler.js','src/v2.10/creative-contract.js',
  'src/v2.10/runtime-integration.js','src/v2.6/renderer-router.js','apps/dashboard/server/http-server.js',
  'src/v2.8/canonical-media-request.js','src/v2.9/negative-intent.js','src/v2.5/production-input.js',
  'src/v2.10/quality-script-first-contract.js','src/v2.10/quality-script-first-service.js',
  'tests/quality-script-first-test.js'];
const patches = new Map(files.filter(file => fs.existsSync(path.join(overlay,file))).map(file => [path.join(repo,file),path.join(overlay,file)]));
const originalFetch = global.fetch;
global.fetch = () => { throw new Error('External HTTP forbidden in compiler tests'); };
function fixtureFromAsset(asset) {
  const r = asset.generation_requirements || {};
  if (r.fixtureUnexpectedError) throw new Error('unexpected failure');
  if (r.fixtureCanonicalError) throw Object.assign(new Error('invalid seed'),{name:'CanonicalMediaRequestError',code:'CANONICAL_SEED_INVALID'});
  const refs = r.references || {};
  return { prompt:r.prompt,canonicalPrompt:r.prompt,providerPrompt:r.prompt,
    capability:r.capability || 'TEXT_TO_VIDEO',
    providerSelection:{provider:r.provider,model:r.model,profile:r.profile || 'STANDARD'},
    requestCompilerVersion:r.request_compiler_version,expectedProviderRequest:r.provider_request_preflight,
    resolution:r.resolution || '720p',durationSeconds:r.target_clip_duration_ms / 1000,
    aspectRatio:r.aspect_ratio || '9:16',resolvedSettings:r.resolved_settings || {},
    references:{firstFrame:refs.first_frame || null,lastFrame:refs.last_frame || null,
      characterImages:refs.character_images || [],styleImages:[],referenceVideos:[],referenceAudios:[]},
    audio:{requested:false},negativePrompt:r.negative_prompt || '',seed:r.seed ?? null };
}
Module._load = function(request,parent,isMain) {
  const candidate = request.startsWith('.') ? path.resolve(path.dirname(parent.filename),request) : path.isAbsolute(request) ? request : null;
  const filename = candidate && (path.extname(candidate) ? candidate : candidate+'.js');
  if (localFixture && filename === path.join(repo,'src/v2.8/canonical-media-request.js')) return {fromAsset:fixtureFromAsset};
  if (patches.has(filename)) {
    if (Module._cache[filename]) return Module._cache[filename].exports;
    const m = new Module(filename,parent);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));Module._cache[filename]=m;
    m._compile(fs.readFileSync(patches.get(filename),'utf8'),filename);m.loaded=true;return m.exports;
  }
  return originalLoad.call(this,request,parent,isMain);
};
const creative = require(path.join(repo,'src/v2.10/creative-contract.js'));
const compiler = require(path.join(repo,'src/v2.8/provider-request-compiler.js'));
let passed = 0;
async function check(name,fn) { await fn(); passed++; console.log('PASS '+name); }
function asset(id,prompt='A quiet kitchen scene.',extra={}) {
  return {asset_id:id,kind:'video',description:prompt,generation_requirements:{
    provider:'replicate',model:'bytedance/seedance-2.5',profile:'STANDARD',prompt,
    capability:'TEXT_TO_VIDEO',resolution:'720p',aspect_ratio:'9:16',target_clip_duration_ms:5000,
    ...extra}};
}
function brief(count=3) {
  return {title:'Synthetic compile test',objective:'APP_INSTALL',targetPlatform:'INSTAGRAM',targetDurationSeconds:5*count,
    aspectRatio:'9:16',hook:'Notice the moment.',coreMessage:'Listen and help.',cta:'Learn more.',
    audienceIntent:'Adults',creativeConcept:'A simple act of support.',visualStyle:'Naturalistic live action.',
    continuity:{identity:'The same adult couple.',appearance:'Natural faces.',wardrobe:'Navy shirt and cream sweater.',
      environment:'The same kitchen.',props:'One phone and one bag.',lightingColorLanguage:'Soft daylight.',cameraLanguage:'Eye-level camera.'},
    storyboard:Array.from({length:count},(_,i)=>({shotId:'shot-'+(i+1),assetId:'video-'+(i+1),durationSeconds:5,
      roles:['ACTION'],purpose:'Purpose '+i,subject:'The adult couple.',environment:'A kitchen.',
      startState:'START_MARKER_'+i,action:'ACTION_MARKER_'+i,intendedEndState:'END_MARKER_'+i,
      emotionalIntent:'Quiet attention.',framing:'A two-person shot.',camera:'Fixed camera.',lensComposition:'35mm lens.',
      lighting:'Soft daylight.',continuity:'The same people.',negativeGuidance:['No extra people.'],referencePolicy:'NONE'}))};
}
const video = {provider:'replicate',model:'bytedance/seedance-2.5',profile:'STANDARD',modelFamily:'SEEDANCE',
  resolvedSettings:{resolution:'720p'},capabilities:['TEXT_TO_VIDEO','IMAGE_TO_VIDEO']};
(async()=>{
  await check('all three shot actions and opening/end states preserved',()=>{
    const b=brief();for(const shot of b.storyboard){const p=creative.buildShotPrompt(b,shot);
      for(const key of ['purpose','subject','environment','startState','action','intendedEndState','framing','camera','lighting']) assert(p.includes(shot[key]));
      for(const other of b.storyboard.filter(s=>s!==shot)) assert(!p.includes(other.action));}
  });
  await check('still excludes movement and future end state',()=>{const b=brief(),s=b.storyboard[0];const p=creative.buildShotPrompt(b,s,{still:true});assert(p.includes(s.startState));assert(!p.includes(s.action));assert(!p.includes(s.intendedEndState));});
  await check('opening still prompt remains byte-for-byte compatible',()=>{const old=require(fs.existsSync(path.join(__dirname,'baseline/creative-contract.js')) ? path.join(__dirname,'baseline/creative-contract.js') : path.join(__dirname,'fixtures/prompt-budget/creative-contract.before.js'));const b=brief(),s={...b.storyboard[0],referencePolicy:'UPLOADED_REFERENCE'};assert.equal(creative.buildShotPrompt(b,s,{still:true}),old.buildShotPrompt(b,s,{still:true}));});
  await check('same words in different temporal states are retained',()=>{const b=brief(),s={...b.storyboard[0],startState:'He holds the phone.',intendedEndState:'He holds the phone.'};assert.equal(creative.buildShotPrompt(b,s).split('He holds the phone.').length-1,2);});
  await check('approved long free text never truncated',()=>{const b=brief(),s={...b.storyboard[0],action:'界'.repeat(5000)};assert(creative.buildShotPrompt(b,s).includes(s.action));});
  await check('Unicode code points and exact boundary',()=>{assert.equal(compiler.assertTextLimit('😀'.repeat(4000),4000),4000);assert.throws(()=>compiler.assertTextLimit('😀'.repeat(4001),4000),e=>e.details.actual===4001);});
  await check('three oversized clips and speech collected in one pass',()=>{
    const a=[asset('video-1'),asset('video-2','x'.repeat(4934)),asset('video-3','y'.repeat(5100)),asset('video-4','z'.repeat(5200)),
      {asset_id:'voice-main',kind:'voice',generation_requirements:{provider:'openai',model:'tts-1',voice:'alloy',text:'a'.repeat(4200)}}];
    const report=compiler.collectProviderPreflight(a);assert.equal(report.length,5);assert.equal(report[0].status,'READY');assert.equal(report.filter(r=>r.status==='BLOCKED').length,4);
    assert.throws(()=>compiler.assertProviderPreflight(report),e=>e.code==='PROVIDER_PREFLIGHT_FAILED'&&e.boundaryState==='NOT_CROSSED'&&e.message.includes('video-2')&&e.message.includes('video-3')&&e.message.includes('video-4')&&e.message.includes('voice-main'));
  });
  await check('resolution and duration errors on separate clips both visible',()=>{
    const r=compiler.collectProviderPreflight([asset('video-1','A shot.',{resolution:'1080p'}),asset('video-2','A shot.',{target_clip_duration_ms:2000})]);
    assert.deepEqual(r.map(x=>x.code),['UNSUPPORTED_RESOLUTION','UNSUPPORTED_DURATION']);
  });
  await check('all eight video routes enforce their existing prompt policy',()=>{
    const all=Object.keys(compiler.CONTRACTS).map((key,i)=>{const slash=key.indexOf('/');return asset('route-'+i,'x'.repeat(21000),{provider:key.slice(0,slash),model:key.slice(slash+1)});});
    const r=compiler.collectProviderPreflight(all);assert.equal(r.length,8);assert(r.every(x=>x.code==='FINAL_PROMPT_TOO_LONG'));assert(r.find(x=>x.model==='gen4.5').maximum===1000);
  });
  await check('deferred reference remains deferred but its length is checked',()=>{
    const extra={model:'alibaba/wan-3',capability:'IMAGE_TO_VIDEO',v210_reference:{policy:'PREVIOUS_SHOT_FRAME',previousAssetId:'video-1'}};
    const r=compiler.collectProviderPreflight([asset('video-2','A scene.',extra),asset('video-3','x'.repeat(5000),extra)]);
    assert.equal(r[0].status,'DEFERRED_REFERENCE');assert(!r[0].fingerprint);assert.equal(r[1].status,'BLOCKED');
  });
  await check('unknown model blocks without switching',()=>{const r=compiler.collectProviderPreflight([asset('video-x','A scene.',{model:'unverified/model'})]);assert.equal(r[0].code,'PROVIDER_CONTRACT_UNVERIFIED');assert.equal(r[0].model,'unverified/model');});
  await check('fresh exact payload certificate verifies; changed prompt fails',()=>{
    const a=asset('video-1'),c=compiler.preflightVideoAsset(a);a.generation_requirements.provider_request_preflight=c;assert.equal(compiler.preflightVideoAsset(a).fingerprint,c.fingerprint);
    a.generation_requirements.prompt+=' Different action.';assert.throws(()=>compiler.preflightVideoAsset(a),e=>e.code==='STALE_PROVIDER_PREFLIGHT');
  });
  await check('old compiler authorization rejected',()=>{assert.throws(()=>compiler.preflightVideoAsset(asset('video-1','A scene.',{request_compiler_version:'provider-request/1'})),e=>e.code==='STALE_PROVIDER_PREFLIGHT');});
  await check('input assets are not mutated',()=>{const a=[asset('video-2','x'.repeat(5000))],before=JSON.stringify(a);compiler.collectProviderPreflight(a);assert.equal(JSON.stringify(a),before);});
  await check('auxiliary image and speech gates stay active',()=>{
    assert.throws(()=>compiler.compileAuxiliaryRequest({asset:{generation_requirements:{prompt:'x'.repeat(32001)}},provider:'openai',model:'gpt-image-1-mini',capability:'image-generation'}),e=>e.code==='FINAL_PROMPT_TOO_LONG');
    assert.throws(()=>compiler.compileAuxiliaryRequest({asset:{generation_requirements:{text:'x'.repeat(5001),voice_id:'fixture'}},provider:'elevenlabs',model:'eleven_v3',capability:'speech-generation'}),e=>e.code==='FINAL_PROMPT_TOO_LONG');
  });
  await check('HTTP safe details retain all asset results and redact arbitrary payload',()=>{
    const {safeErrorDetails}=require(path.join(repo,'apps/dashboard/server/http-server.js'));
    const e={details:{providerExecutions:0,providerPreflight:{results:[{assetId:'video-2',status:'BLOCKED',code:'FINAL_PROMPT_TOO_LONG',actual:4934,maximum:4000,prompt:'PRIVATE_PROMPT',apiKey:'SECRET',references:['SECRET_URL'],payload:{secret:'SECRET'}}]}}};
    const d=safeErrorDetails(e);assert.equal(d.providerPreflight.results[0].actual,4934);assert(!JSON.stringify(d).includes('SECRET'));assert(!JSON.stringify(d).includes('PRIVATE_PROMPT'));
    assert.deepEqual(safeErrorDetails({details:{validation:{status:'FAIL'},providerExecutions:0}}),{validation:{status:'FAIL'},providerExecutions:0});
  });
  await check('actual HTTP response contains every failed asset',async()=>{
    const http=require('node:http');const {createControlServer}=require(path.join(repo,'apps/dashboard/server/http-server.js'));
    const server=createControlServer({service:{},creativeService:{preflight:async()=>compiler.preflightProviderAssets([asset('video-2','x'.repeat(5000)),asset('video-3','y'.repeat(5000))])}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {const result=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/v2.10/creative-drafts/test/preflight',method:'POST',headers:{'Content-Type':'application/json'}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.end('{}');});
      assert.equal(result.status,409);assert.deepEqual(result.body.error.details.providerPreflight.results.map(r=>r.assetId),['video-2','video-3']);
    } finally {await new Promise(resolve=>server.close(resolve));}
  });
  await check('V2.10 rebinds exact current prompts after legacy lower assembly',()=>{
    const {buildCanonicalV210Input}=require(path.join(repo,'src/v2.10/runtime-integration.js'));
    const b=brief(),draft={id:'00000000-0000-4000-8000-000000000001',brand_id:'00000000-0000-4000-8000-000000000002',creative_brief:b};
    const result=buildCanonicalV210Input({draft,preflight:{authoritativeVideo:video},env:{}});
    const videos=result.input.assetPlan.assets.filter(a=>a.kind==='video');assert.equal(videos.length,3);
    for(let i=0;i<3;i++){assert.equal(videos[i].generation_requirements.prompt,creative.buildShotPrompt(b,creative.canonicalCreativeBrief(b).storyboard[i]));assert.equal(videos[i].generation_requirements.prompt_compiler_version,'shot/4');assert.equal(videos[i].generation_requirements.provider_request_preflight.status,'READY');}
  });
  await check('V2.10 reports oversized shots 2 AND 3 before returning an input',()=>{
    const {buildCanonicalV210Input}=require(path.join(repo,'src/v2.10/runtime-integration.js'));const b=brief();b.storyboard[1].action='x'.repeat(5000);b.storyboard[2].action='y'.repeat(5000);
    assert.throws(()=>buildCanonicalV210Input({draft:{id:'00000000-0000-4000-8000-000000000001',brand_id:'00000000-0000-4000-8000-000000000002',creative_brief:b},preflight:{authoritativeVideo:video},env:{}}),e=>e.details?.providerPreflight?.results.filter(r=>r.status==='BLOCKED').length===2);
  });
  await check('renderer also reports all clips before any DB operation',async()=>{
    const {QualityRendererLane}=require(path.join(repo,'src/v2.6/renderer-router.js'));let touched=false;
    const lane=new QualityRendererLane({masterOrchestrator:{build(){}},mediaExecutionRepository:{inspectSchema(){touched=true;throw Error('must not access DB');}},env:{}});
    await assert.rejects(lane.preflight({input:{schemaVersion:2,assetPlan:{assets:[asset('video-2','x'.repeat(5000)),asset('video-3','y'.repeat(5000))]}},brand:{}}),e=>e.code==='PROVIDER_PREFLIGHT_FAILED');assert(!touched);
  });
  await check('camera round trips do not accumulate repeated composition',()=>{
    const contract=require(path.join(repo,'src/v2.10/quality-script-first-contract.js'));
    const {QualityScriptFirstService}=require(path.join(repo,'src/v2.10/quality-script-first-service.js'));
    const service=new QualityScriptFirstService({repository:{},brandRepository:{}});
    let b=brief(4);b.storyboard.forEach(s=>{s.lensComposition='35mm lens; both faces visible; 35mm lens; both faces visible';});
    for(let round=0;round<30;round++){
      const storyboard=contract.buildStoryboardScaffold(b,{});
      b=service.applyStoryboardToBrief(b,storyboard,{});
      for(const s of b.storyboard)assert.equal(s.lensComposition,'35mm lens; both faces visible');
    }
  });
  await check('legacy combined camera value is inherited once',()=>{
    const {canonicalShotContract}=require(path.join(repo,'src/v2.10/quality-script-first-contract.js'));
    const s=canonicalShotContract({},0,{lensComposition:'35mm lens; low angle'});
    assert.equal(s.camera.lensIntent,'');assert.equal(s.camera.composition,'35mm lens; low angle');
    const explicit=canonicalShotContract({camera:{angle:'Low angle',lensIntent:'50mm',composition:'One person'}},0,{});
    assert.equal(creative.uniqueCameraInstructions(explicit.camera.angle,explicit.camera.lensIntent,explicit.camera.composition),'Low angle; 50mm; One person');
  });
  await check('different camera instructions and all temporal repetitions survive',()=>{
    const b=brief(),s={...b.storyboard[0],lensComposition:'35mm lens; 50mm lens',startState:'He holds one phone.',action:'He holds one phone.',intendedEndState:'He holds one phone.'};
    const p=creative.buildShotPrompt(b,s);assert(p.includes(s.lensComposition));assert.equal(p.split(s.startState).length-1,3);
  });
  await check('negative guidance retains its negative scope',()=>{
    const b=brief(),s={...b.storyboard[0],negativeGuidance:['extra people','generated captions']};
    assert(creative.buildShotPrompt(b,s).includes('Avoid: extra people\ngenerated captions'));
  });
  await check('default constraints appear once for new shots; legacy/custom translation stays explicit',()=>{
    const {translateProviderPrompt,DEFAULT_NEGATIVE_INTENT}=require(path.join(repo,'src/v2.9/negative-intent.js'));
    const args={canonicalPrompt:'A test shot.',provider:'replicate',model:'bytedance/seedance-2.5',capability:'TEXT_TO_VIDEO'};
    const compact=translateProviderPrompt({...args,promptCompilerVersion:'shot/4'});
    assert.equal(compact.adapterVersion,'provider-prompt/3');assert(!compact.providerPrompt.includes('Production constraints:'));
    assert.equal(compact.providerPrompt.split('No panels, text').length-1,1);
    const legacy=translateProviderPrompt({...args,promptCompilerVersion:'shot/3'});assert(legacy.providerPrompt.includes('Seedance instruction:'));
    const custom={...DEFAULT_NEGATIVE_INTENT,typography:{policy:'ALLOW_APPROVED_TEXT'}};
    assert.equal(translateProviderPrompt({...args,negativeIntent:custom,promptCompilerVersion:'shot/4'}).providerPrompt,
      translateProviderPrompt({...args,negativeIntent:custom}).providerPrompt);
    assert.equal(translateProviderPrompt({...args,capability:'TEXT_TO_IMAGE',promptCompilerVersion:'shot/4'}).providerPrompt,args.canonicalPrompt);
  });
  await check('final translated 4000/4001 boundary checked, never canonical length alone',()=>{
    const {fromAsset}=require(path.join(repo,'src/v2.8/canonical-media-request.js'));
    const flags={prompt_compiler_version:'shot/4'};
    const extra=Array.from(fromAsset(asset('video-x','x',flags)).providerPrompt).length-1;
    const valid=asset('video-x','界'.repeat(4000-extra),flags);
    assert.equal(compiler.preflightVideoAsset(valid).promptCharacters,4000);
    assert.throws(()=>compiler.preflightVideoAsset(asset('video-x','界'.repeat(4001-extra),flags)),e=>e.code==='FINAL_PROMPT_TOO_LONG'&&e.details.actual===4001);
  });
  await check('previous package authorization cannot authorize new compiler payload',()=>{
    assert.throws(()=>compiler.preflightVideoAsset(asset('video-x','A shot.',{request_compiler_version:'provider-request/2'})),e=>e.code==='STALE_PROVIDER_PREFLIGHT');
  });
  await check('all approved source fields survive compilation without truncation',()=>{
    const b=brief(),s=b.storyboard[0];s.mustKeep=['KEEP_MARKER'];s.mayChange=['CHANGE_MARKER'];
    const p=creative.buildShotPrompt(b,s);
    for(const key of ['purpose','subject','action','environment','emotionalIntent','framing','camera','lensComposition','lighting','continuity','startState','intendedEndState'])assert(p.includes(s[key]),key);
    for(const key of ['identity','appearance','wardrobe','environment','props','lightingColorLanguage','cameraLanguage'])assert(p.includes(b.continuity[key]),key);
    assert(p.includes(b.visualStyle));assert(p.includes('MUST KEEP: KEEP_MARKER'));assert(p.includes('MAY CHANGE: CHANGE_MARKER'));
  });
  for(const suite of ['quality-script-first-test.js','v2.10-runtime-integration-test.js']) {
    if(fs.existsSync(path.join(repo,'tests',suite))) await check('existing '+suite,()=>require(path.join(repo,'tests',suite)));
  }
  if(localFixture) await check('known canonical errors aggregate; unexpected errors stay fatal',()=>{
    const r=compiler.collectProviderPreflight([asset('video-a','A scene.',{fixtureCanonicalError:true}),asset('video-b','x'.repeat(5000))]);assert.equal(r.length,2);
    assert.throws(()=>compiler.collectProviderPreflight([asset('video-a','A scene.',{fixtureUnexpectedError:true})]),/unexpected failure/);
  });
  console.log(`RESULT ${passed} checks PASS; provider calls 0; database operations 0; mode ${localFixture?'isolated canonical fixture with older dependency tree':'current repository dependencies'}`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{Module._load=originalLoad;global.fetch=originalFetch;});
