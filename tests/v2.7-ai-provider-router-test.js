'use strict';
const assert = require('node:assert/strict');
const { AIProviderRouter } = require('../worker/v2.7-ai-provider-router');
const router = new AIProviderRouter({ nvidia:{ async generate(req){ return {model:req.model,content:'nvidia-ok',usage:{tokens:1}}; } }, openai:{ async generate(){ return {model:'gpt-test',content:'openai-ok',usage:{tokens:2}}; } } });
(async()=>{
  const a=await router.generate('nvidia',{model:'nvidia/test',messages:[]});
  const b=await router.generate('openai',{model:'gpt-test',messages:[]});
  assert.equal(a.content,'nvidia-ok'); assert.equal(b.content,'openai-ok');
  await assert.rejects(()=>router.generate('missing',{messages:[]}),/not registered/);
  console.log('V2.7 AI provider router certification: PASS');
})().catch(err=>{console.error(err);process.exit(1);});
