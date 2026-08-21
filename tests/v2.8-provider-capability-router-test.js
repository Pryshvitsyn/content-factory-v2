'use strict';
const assert = require('node:assert/strict');
const { CapabilityRouter } = require('../worker/v2.8-provider-capability-router');
let attempts = 0;
const router = new CapabilityRouter({
  nvidia:{capabilities:['research'],async generate(){attempts++; if(attempts===1) throw new Error('temporary'); return {model:'nvidia/test',content:'ok',usage:{tokens:1}};}},
  openai:{capabilities:['creative'],async generate(){return {model:'gpt-test',content:'fallback',usage:{tokens:2}};}}
});
(async()=>{
 const a=await router.generate({provider:'nvidia',capability:'research',request:{messages:[]},maxRetries:1});
 assert.equal(a.content,'ok'); assert.equal(a.attempts,2);
 const b=await router.generate({capability:'creative',request:{messages:[]}});
 assert.equal(b.provider,'openai');
 await assert.rejects(()=>router.generate({capability:'visual',request:{messages:[]}}),/no capable provider available/);
 console.log('V2.8 provider capability/reliability certification: PASS');
})().catch(err=>{console.error(err);process.exit(1);});
