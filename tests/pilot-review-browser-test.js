'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-review-browser-'));
  const name = `pilot-check-${process.pid}.html`;
  const fixture = path.join(root, 'apps/dashboard/client', name);
  let browser; let vite;
  try {
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=navy:s=180x320:r=25',
      '-t','1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(temp,'pilot.mp4')]);
    const bytes = await fs.readFile(path.join(temp,'pilot.mp4'));
    await fs.writeFile(fixture, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {PilotReview} from './src/PilotReview.jsx'; import './src/CreativeProduction.css';
createRoot(document.getElementById('root')).render(React.createElement(PilotReview,{review:{state:'FIRST_VIDEO_REVIEW',status:'SUCCEEDED',contentUrl:'/synthetic-pilot.mp4',canApprove:true,canReject:true,quality:{status:'WARN',checks:[{code:'PROP_NOT_VISIBLE',status:'WARN',reason:'Bag placement is not visible.'}]}},onDecision:()=>{document.body.dataset.decided='true'}}));
</script></body></html>`, { flag: 'wx' });
    vite = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--config','apps/dashboard/client/vite.config.js','--port','3127'],
      { cwd: root, env: { ...process.env, LIVE_PAID_GENERATION: 'false' }, stdio: ['ignore','pipe','pipe'] });
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite startup timed out')),15000);
      vite.on('error', reject); vite.on('exit', code => { clearTimeout(timeout); reject(new Error(`Vite exited ${code}`)); });
      vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timeout); resolve(); } });
    });
    browser = await chromium.launch({ headless:true });
    const page = await browser.newPage({ viewport:{width:1280,height:900} });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/synthetic-pilot.mp4', route => route.fulfill({ contentType:'video/mp4', body:bytes }));
    await page.goto(`http://127.0.0.1:3127/${name}`);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.getByLabel('Saved pilot video').evaluate(video => video.play());
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    assert.equal(await page.getByRole('button',{name:'APPROVE LOOK & MOTION'}).isDisabled(), false);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.getByRole('button',{name:'APPROVE LOOK & MOTION'}).click();
    assert.equal(await page.locator('body').getAttribute('data-decided'),'true');

    // Exercise the second entry point too: the static Director must show the same saved pilot.
    const review = { workflowId:'wf',attemptId:'exact-attempt',state:'FIRST_VIDEO_REVIEW',status:'SUCCEEDED',canApprove:true,canReject:true,
      contentUrl:'/synthetic-pilot.mp4',quality:{status:'WARN',checks:[{code:'PROP_NOT_VISIBLE',status:'WARN',reason:'Bag placement is not visible.'}]} };
    const writes = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let body;
      if(url.pathname==='/api/brands') body=[{id:'brand',name:'Synthetic brand'}];
      else if(url.pathname==='/api/v2.10/creative-drafts') body=[{id:'draft',creative_brief:{title:'Synthetic pilot'},revision:1,status:'DRAFT'}];
      else if(url.pathname.endsWith('/quality-director')) body={workflow:{id:'wf',state:'FIRST_VIDEO_REVIEW'},pilotReview:review};
      else { writes.push({path:url.pathname,body:route.request().postDataJSON()});body={approved:true}; }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto('http://127.0.0.1:3127/quality-director.html');
    await page.locator('#brand').selectOption('brand');
    await page.locator('#draft').selectOption('draft');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    assert.equal(await page.locator('#approvePilot').isDisabled(),false);
    assert.equal(writes.length,0,'opening and playing a pilot never writes or generates');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#approvePilot').click();
    await page.waitForFunction(() => document.getElementById('message').textContent.includes('Pilot human-approved'));
    assert.equal(writes.length,1); assert.equal(writes[0].body.attemptId,'exact-attempt');
    assert(writes[0].path.endsWith('/pilot-approve'));
    assert.deepEqual(errors,[]);
    console.log('PASS Chromium: real local MP4 playback, mobile layout, both review screens, exact attempt decision; real provider calls: 0.');
  } finally {
    await browser?.close(); vite?.kill('SIGTERM');
    await fs.rm(fixture,{force:true}); await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
