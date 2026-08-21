'use strict';
const assert = require('node:assert/strict');
const { MultiBrainRouter } = require('../worker/v2.7-multi-brain-router');
const router = new MultiBrainRouter({
  brains:{research:{generate:async()=> 'research'},creative:{generate:async()=> 'creative'},critic:{generate:async()=> 'critic'}},
  routes:{research:{brain_id:'research'},creative:{brain_id:'creative'},validation:{brain_id:'critic'}}
});
(async()=>{
  assert.equal(await router.route('research',{}),'research');
  assert.equal(await router.route('creative',{}),'creative');
  assert.equal(await router.route('validation',{}),'critic');
  await assert.rejects(()=>router.route('missing',{}),/stage not routed/);
  console.log('V2.7 multi-brain routing certification: PASS');
})().catch(err=>{console.error(err);process.exit(1);});
