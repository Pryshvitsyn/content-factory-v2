import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarDetail, AvatarStudio, LevelLadder } from '../src/AvatarStudio';

const brand = { id: '11111111-1111-4111-8111-111111111111', name: 'Attune' };
function response(payload, ok = true) { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload }); }

describe('Avatar Studio dashboard', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => response([brand]))); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the Library, Create Avatar and plan-only Test Content screens', async () => {
    render(<AvatarStudio />);
    expect(screen.getByRole('heading', { name: 'Avatar Studio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'LIBRARY' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PASSPORT LAB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'BODY + EXPRESSIONS LAB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'GATE 0 REVIEW' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CREATE AVATAR' }));
    expect(screen.getByRole('heading', { name: 'Context' })).toBeTruthy();
    for (const name of ['Audience vertical','Allowed brand','Identity source type','Persona role','Intended channels']) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'TEST CONTENT' }));
    expect(screen.getByRole('heading', { name: 'Plan-only Test Content' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'COMPILE PLAN · ZERO PAID CALLS' })).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/brands', expect.anything()));
    expect(fetch.mock.calls.some(([url]) => String(url).includes('provider'))).toBe(false);
  });

  it('completes synthetic browser intake without typing an artifact id', async () => {
    const avatar = { id: 'avatar-1', internalName: 'Mara', vertical: 'PSYCHOLOGY_WELLBEING', subjectType: 'SYNTHETIC',
      currentLevel: 0, currentLevelName: 'IDENTITY', brandIds: [brand.id] };
    const intake = { asset: { id: 'intake-1', characterId: avatar.id, brandId: brand.id, effectiveGate0Status: 'PASS',
      effectiveRightsStatus: 'NOT_REQUIRED', artifactId: 'avatar-source-immutable', artifactVersion: 1, contentHash: 'a'.repeat(64),
      mimeType: 'image/jpeg', byteSize: 1234, width: 1080, height: 1350, durationMs: null, gate0Findings: [],
      previewUrl: `/api/avatar-studio/intakes/intake-1/content?brandId=${brand.id}&avatarId=${avatar.id}` },
      gate0: { status: 'PASS', findings: [], paidProviderCalls: 0, externalGenerationCalls: 0 } };
    fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/brands') return response([brand]);
      if (url === '/api/avatar-studio/avatars' && options.method === 'POST') return response(avatar);
      if (String(url).endsWith('/intakes') && options.method === 'POST') return response(intake);
      if (String(url).endsWith('/use') && options.method === 'POST') return response({ source: { id: 'source-1' }, paidProviderCalls: 0 });
      if (String(url).endsWith('/identity') && options.method === 'POST') return response({ identityVersion: { version: 2 }, avatar });
      if (String(url).endsWith('/identity-locks') && options.method === 'POST') return response({ identityLock: { id: 'lock-1' }, avatar });
      return response([]);
    });
    render(<AvatarStudio />); await screen.findByRole('option', { name: 'Attune' });
    fireEvent.click(screen.getByRole('button', { name: 'CREATE AVATAR' }));
    fireEvent.change(screen.getByLabelText('Allowed brand'), { target: { value: brand.id } });
    fireEvent.change(screen.getByLabelText('Internal avatar name'), { target: { value: 'Mara' } });
    fireEvent.change(screen.getByLabelText('Persona role'), { target: { value: 'calm expert' } });
    fireEvent.click(screen.getByRole('button', { name: 'START ASSET INTAKE' }));
    await screen.findByRole('heading', { name: 'Asset intake' });
    expect(screen.queryByLabelText(/artifact id/i)).toBeNull();
    const file = new File([new Uint8Array([0xff,0xd8,0xff,0xd9])], 'mara.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Avatar source file'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'Gate 0, rights and source roles' });
    expect(screen.getByAltText('Avatar source preview')).toBeTruthy(); expect(screen.getByText('PASS')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'USE AS AVATAR SOURCE' }));
    await screen.findByRole('heading', { name: 'Identity' });
    for (const [label,value] of [['Age presentation','late 30s'],['Personality','calm and precise'],
      ['Visual direction','natural portrait'],['Prohibited uses','deception']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE IMMUTABLE IDENTITY VERSION' }));
    await screen.findByRole('heading', { name: 'Identity Lock' });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE IMMUTABLE IDENTITY LOCK' }));
    await screen.findByRole('heading', { name: 'Ready for Passport Lab' });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/use'))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('provider'))).toBe(false);
  });

  it('opens a real Passport Lab and keeps L0 before human certification', async () => {
    const avatar = { id:'avatar-1',internalName:'Mara',vertical:'PSYCHOLOGY_WELLBEING',subjectType:'SYNTHETIC',currentLevel:0,
      currentLevelName:'IDENTITY',identityVersionId:'identity-v2',version:2,sources:[{id:'source-1',brandId:brand.id,gate0Status:'PASS',
        roles:['IDENTITY','PASSPORT_SOURCE'],artifactId:'source-artifact',artifactVersion:1}],identityLocks:[],passportCandidates:[] };
    fetch.mockImplementation((url) => {
      if (url === '/api/brands') return response([brand]);
      if (String(url).startsWith('/api/avatar-studio/avatars?')) return response([{id:'avatar-1',internalName:'Mara',currentLevel:0}]);
      if (String(url).includes('/passport-lab?')) return response(avatar);
      return response([]);
    });
    render(<AvatarStudio />); await screen.findByRole('option',{name:'Attune'});
    fireEvent.click(screen.getByRole('button',{name:'PASSPORT LAB'}));
    fireEvent.change(screen.getByLabelText('Passport brand scope'),{target:{value:brand.id}});
    await screen.findByRole('option',{name:'Mara · L0'});
    fireEvent.change(screen.getByLabelText('Passport avatar'),{target:{value:'avatar-1'}});
    await screen.findByRole('heading',{name:'Mara · Passport Lab'});
    expect(screen.getByText('CERTIFIED PASSPORT REQUIRED')).toBeTruthy();
    expect(screen.getByRole('button',{name:'SAVE IMMUTABLE IDENTITY LOCK'})).toBeTruthy();
    expect(screen.queryByText('PASSPORT COMPLETE · NEXT L2 BODY + EXPRESSIONS')).toBeNull();
  });

  it('runs guided candidate comparison and displays L1 only after human certification', async () => {
    let certified=false;
    const lab=()=>({id:'avatar-1',internalName:'Mara',vertical:'PSYCHOLOGY_WELLBEING',subjectType:'SYNTHETIC',
      currentLevel:certified?1:0,currentLevelName:certified?'PASSPORT':'IDENTITY',identityVersionId:'identity-v2',version:2,
      sources:[{id:'source-1',brandId:brand.id,gate0Status:'PASS',roles:['IDENTITY','PASSPORT_SOURCE'],artifactId:'source-artifact',artifactVersion:1}],
      identityLocks:[{id:'lock-1',identityVersionId:'identity-v2',version:1,permanentAttributes:{nose:'preserve'},temporaryAttributes:{hat:'exclude'},uncertainAttributes:{}}],
      passportGenerationSpecs:[{id:'plan-1',plannedExternalCallCount:4,promptVersion:'AVATAR_PASSPORT_BASE@1.0.0',costPlan:{knownTotalCost:null}}],
      passportCandidates:[{id:'candidate-b',previewUrl:'/candidate-b.png',qaSnapshotId:'qa-1',qaStatus:'WARN',qaWarnings:['PROFILE_IDENTITY'],
        qaBlockingFailures:[],humanReviewState:'KEPT',certificationState:certified?'CERTIFIED':'UNCERTIFIED',samePersonConfidence:null,
        provider:'MANUAL_UPLOAD',model:'none',promptVersion:'AVATAR_PASSPORT_BASE@1.0.0',specVersion:'v1',costStatus:'UNKNOWN',createdAt:'2026-09-01'}]});
    fetch.mockImplementation((url,options={})=>{
      if(url==='/api/brands')return response([brand]);
      if(String(url).startsWith('/api/avatar-studio/avatars?'))return response([{id:'avatar-1',internalName:'Mara',currentLevel:0}]);
      if(String(url).includes('/passport-lab?'))return response(lab());
      if(String(url).endsWith('/certify')&&options.method==='POST'){certified=true;return response({avatar:lab(),paidProviderCalls:0,externalGenerationCalls:0});}
      return response([]);
    });
    render(<AvatarStudio/>);await screen.findByRole('option',{name:'Attune'});fireEvent.click(screen.getByRole('button',{name:'PASSPORT LAB'}));
    fireEvent.change(screen.getByLabelText('Passport brand scope'),{target:{value:brand.id}});await screen.findByRole('option',{name:'Mara · L0'});
    fireEvent.change(screen.getByLabelText('Passport avatar'),{target:{value:'avatar-1'}});await screen.findByAltText('Passport candidate A');
    expect(screen.getByText('CERTIFIED PASSPORT REQUIRED')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'COMPARE'}));
    expect(screen.getByLabelText('Maximum allowed cost')).toBeTruthy();
    expect(screen.getByRole('button',{name:'RUN FRESH COST PREFLIGHT'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'APPROVE EXECUTION'}).disabled).toBe(true);
    expect(screen.getByRole('button',{name:'GENERATE PASSPORT CANDIDATES'}).disabled).toBe(true);
    for(const label of ['Clearly the source identity','Clearly the same person','Profile cannot be mistaken for another human',
      'All three are one identity','I explicitly certify this exact immutable candidate and acknowledge its recorded QA warnings.']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button',{name:'HUMAN-CERTIFY THIS PASSPORT'}));
    await screen.findByText('PASSPORT COMPLETE · NEXT L2 BODY + EXPRESSIONS');
    const call=fetch.mock.calls.find(([url])=>String(url).endsWith('/passport-candidates/candidate-b/certify'));
    expect(call).toBeTruthy();const body=JSON.parse(call[1].body);expect(body.humanApproval).toBe(true);expect(body.explicitConfirmation).toBe(true);
    expect(body.guidedReview).toMatchObject({frontal:true,threeQuarter:true,profile:true,allThree:true});
  });

  it('shows all explicit L0-L7 states and next-level focus', () => {
    render(<LevelLadder avatar={{ currentLevel: 3 }} />);
    expect(screen.getByText('L0')).toBeTruthy(); expect(screen.getByText('L7')).toBeTruthy();
    expect(screen.getByText('MULTISHOT CONTINUITY')).toBeTruthy();
    expect(screen.getAllByText('COMPLETE')).toHaveLength(4);
    expect(screen.getByText('NEXT')).toBeTruthy();
  });

  it('shows exactly one actionable next-level workflow on Avatar Detail', () => {
    render(<AvatarDetail brandId={brand.id} close={() => {}} onUpdated={() => {}} avatar={{ id: 'avatar-1', internalName: 'Mara',
      vertical: 'PSYCHOLOGY_WELLBEING', currentLevel: 1, currentLevelName: 'PASSPORT', nextLevel: { level: 2, name: 'BODY_EXPRESSIONS' },
      completedRequirements: [], missingRequirements: ['BODY_CHEST_UP'], blockingFailures: [], consent: { status: 'APPROVED' } }} />);
    expect(screen.getByRole('heading', { name: 'Next level · L2 BODY_EXPRESSIONS' })).toBeTruthy();
    expect(screen.getByText(/Open BODY \+ EXPRESSIONS LAB/)).toBeTruthy();
    expect(screen.queryByLabelText('Wardrobe pack name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'APPROVE LEVEL 2' })).toBeNull();
  });
});
