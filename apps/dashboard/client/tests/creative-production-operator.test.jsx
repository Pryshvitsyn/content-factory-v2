import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreativeProduction } from '../src/CreativeProduction';

const brandId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';

function response(payload, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload });
}

function shot(id, roles) {
  return {
    shotId: id, assetId: `video-${id}`, durationSeconds: 5, roles,
    purpose: 'Advance a concrete relationship story beat',
    subject: 'The same adult couple sitting together on a sofa',
    action: 'They make a small visible restrained emotional movement',
    environment: 'A warm lived-in apartment living room in the evening',
    emotionalIntent: 'Quiet believable emotional attention and connection',
    framing: 'Vertical eye-level medium shot of the couple',
    camera: 'Restrained slow observational camera movement',
    lensComposition: 'Natural perspective balanced two-person composition',
    lighting: 'Warm practical lamps with soft evening contrast',
    continuity: 'Preserve the same faces wardrobe apartment props lighting and camera language',
    negativeGuidance: 'No generated text, melodrama, extra people or watermarks',
    referencePolicy: 'NONE', voiceoverSegment: '',
  };
}

function savedBrief() {
  return {
    title: 'Notice the Moment', objective: 'Help couples notice before assuming', targetPlatform: 'Instagram Reels',
    targetDurationSeconds: 10, hook: 'Sometimes distance is not rejection', coreMessage: 'Notice before reacting',
    cta: "Don't guess. Tune in.", audienceIntent: 'Thoughtful couples who want calmer communication',
    creativeConcept: 'A subtle apartment moment moves from tension to attention',
    visualStyle: 'Warm restrained cinematic realism with authentic micro-expressions',
    storyboard: [shot('s1', ['HOOK','TENSION']), shot('s2', ['INSIGHT','ACTION','RESOLUTION','CTA'])],
    continuity: {
      identity: 'One consistent adult couple throughout all shots', appearance: 'Natural everyday appearance with consistent faces',
      wardrobe: 'Simple neutral home clothing remains unchanged', environment: 'Warm apartment living room with the same sofa',
      props: 'Sofa side table and practical lamp remain fixed', lightingColorLanguage: 'Warm soft evening practical lighting',
      cameraLanguage: 'Restrained eye-level observational vertical camera', referencePolicy: 'NONE',
    },
    voice: { sourceType: null, provider: '', model: '', voiceId: '', language: 'en', instructions: '', approved: false },
    postProduction: { endTitle: { enabled: true, text: "Don't guess. Tune in.", startTime: 8, duration: 2 }, brandName: 'Attune' },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}

describe('V2.10 operator-first Creative Production UX', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resumes a saved draft and derives Wan 3 profile/resolution/capabilities from the server catalog', async () => {
    const methods = [];
    const providers = [{
      id: 'replicate', displayName: 'Replicate', configured: true, models: [{
        modelId: 'alibaba/wan-3', displayName: 'Wan 3', modelFamily: 'WAN_3', selectable: true,
        capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','AUDIO_DISABLE_SUPPORTED'], constraints: { aspectRatios: ['9:16','16:9'] },
        profiles: { ECONOMY: { resolution: '480p' }, STANDARD: { resolution: '720p' }, PREMIUM: { resolution: '1080p' } },
      }],
    }];
    const drafts = [{
      id: draftId, brand_id: brandId, status: 'DRAFT', revision: 3, creative_brief: savedBrief(),
      provider_selection: { provider: 'replicate', model: 'alibaba/wan-3', modelFamily: 'WAN_3', profile: 'QUALITY', resolution: '1080x1920' },
    }];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      methods.push([url, options.method || 'GET']);
      if (url === '/api/brands') return response([{ id: brandId, name: 'Attune' }]);
      if (url === '/api/providers') return response(providers);
      if (String(url).startsWith('/api/v2.10/creative-drafts?')) return response(drafts);
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<CreativeProduction />);
    fireEvent.change(await screen.findByLabelText('BRAND'), { target: { value: brandId } });

    await waitFor(() => expect(screen.getByLabelText('VIDEO PROVIDER').value).toBe('replicate'));
    expect(screen.getByLabelText('VIDEO MODEL').value).toBe('alibaba/wan-3');
    expect(screen.getByLabelText('VIDEO PROFILE').value).toBe('STANDARD');
    expect(screen.getByLabelText('RESOLVED OUTPUT').value).toContain('720p source');
    expect(screen.getByLabelText('OUTPUT FORMAT').value).toBe('9:16');
    fireEvent.change(screen.getByLabelText('OUTPUT FORMAT'), { target: { value: '16:9' } });
    expect(screen.getByLabelText('RESOLVED OUTPUT').value).toContain('16:9 · final master 1920×1080');
    expect(screen.getByText('WAN_3')).toBeTruthy();
    expect(screen.getByText(/TEXT_TO_VIDEO · IMAGE_TO_VIDEO/)).toBeTruthy();
    expect(screen.getByLabelText('DRAFT').value).toBe(draftId);
    expect(screen.queryByText('Provider/model supports image-to-video continuity')).toBeNull();
    expect(methods.every(([, method]) => method === 'GET')).toBe(true);
  });
});

describe('Current LOOK recovery', () => {
 afterEach(() => vi.unstubAllGlobals());
 it('restores an approved frame but requires current LOOK review; blocks full Start until pilot approval', async () => {
  const calls=[];
  const pf={status:'READY',creative:{storyboardShots:2,completeness:'PASS',continuity:'READY'},externalCalls:{},master:{}};
  vi.stubGlobal('fetch',vi.fn((url,options={})=>{
   calls.push([url,options]);
   if(url==='/api/brands') return response([{id:brandId,name:'Test'}]);
   if(url==='/api/providers') return response([]);
   if(String(url).includes('/quality-director?')) return response({look:{status:'REVIEW_REQUIRED',reason:'Review existing frame',canApprove:true,approved:false,keyframeId:'kf',keyframeApprovalDecision:'APPROVED',expectedFingerprint:'context'},pilot:{approved:false}});
   if(String(url).includes('/locked-keyframe/state?')) return response({keyframeResult:{keyframe:{id:'kf',approvalDecision:'APPROVED'},validation:{status:'PASS'}}});
   if(String(url).startsWith('/api/v2.10/creative-drafts?')) return response([{id:draftId,revision:1,status:'PREFLIGHT_READY',creative_brief:{...savedBrief(),aspectRatio:'9:16'},final_preflight:pf}]);
   throw new Error(`Unexpected ${url}`);
  }));
  render(<CreativeProduction/>);
  fireEvent.change(await screen.findByLabelText('BRAND'),{target:{value:brandId}});
  const review=await screen.findByRole('button',{name:'REVIEW & APPROVE CURRENT LOOK'});
  await screen.findByText(/LOOK: REVIEW_REQUIRED/);
  const image = screen.queryByRole('img');
  if (image) fireEvent.load(image);
  await waitFor(()=>expect(review.disabled).toBe(false));
  expect(screen.getByRole('button',{name:'START PRODUCTION'}).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'FIRST VIDEO PREFLIGHT · 0 CALLS'}).disabled).toBe(true);
  expect(screen.getByText(/LOOK: REVIEW_REQUIRED/)).toBeTruthy();
  expect(calls.every(([,options])=>!options.method || options.method==='GET')).toBe(true);
 });
});

describe('Complete provider blocker report', () => {
 afterEach(() => vi.unstubAllGlobals());
 it('shows every failed asset after preflight and keeps Start disabled', async () => {
  const draft={id:draftId,revision:1,status:'DRAFT',creative_brief:{...savedBrief(),aspectRatio:'9:16'},provider_selection:{provider:'replicate',model:'alibaba/wan-3',profile:'STANDARD'}};
  const results=[2,3,4].map(n=>({assetId:`video-${n}`,model:'alibaba/wan-3',status:'BLOCKED',code:'FINAL_PROMPT_TOO_LONG',actual:4500+n,maximum:4000}));
  const calls=[];
  vi.stubGlobal('fetch',vi.fn((url,options={})=>{
   calls.push([url,options.method||'GET']);
   if(url==='/api/brands')return response([{id:brandId,name:'Test'}]);
   if(url==='/api/providers')return response([{id:'replicate',configured:true,models:[{modelId:'alibaba/wan-3',selectable:true,capabilities:['TEXT_TO_VIDEO','IMAGE_TO_VIDEO'],profiles:{STANDARD:{resolution:'720p'}}}]}]);
   if(String(url).includes('/quality-director?'))return response({look:{approved:true},pilot:{approved:false}});
   if(String(url).includes('/locked-keyframe/state?'))return response({});
   if(String(url).endsWith('/preflight'))return response({error:{code:'PROVIDER_PREFLIGHT_FAILED',message:'All failed assets',details:{providerPreflight:{results}}}},false);
   if(options.method==='PATCH')return response(draft);
   if(String(url).startsWith('/api/v2.10/creative-drafts?'))return response([draft]);
   throw Error(`Unexpected ${url}`);
  }));
  render(<CreativeProduction/>);
  fireEvent.change(await screen.findByLabelText('BRAND'),{target:{value:brandId}});
  const button=await screen.findByRole('button',{name:'FINAL PRODUCTION PREFLIGHT · 0 CALLS'});
  await waitFor(()=>expect(button.disabled).toBe(false));fireEvent.click(button);
  await screen.findByRole('region',{name:'Provider preflight results'});
  for(const n of [2,3,4])expect(screen.getByText(`video-${n}`)).toBeTruthy();
  expect(screen.getByRole('button',{name:'START FIRST VIDEO ONLY'}).disabled).toBe(true);
  expect(calls.some(([url])=>String(url).endsWith('/video-start')||String(url).endsWith('/start'))).toBe(false);
 });
});
