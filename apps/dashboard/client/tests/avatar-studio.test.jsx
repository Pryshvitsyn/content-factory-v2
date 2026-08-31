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
    await screen.findByRole('heading', { name: 'Avatar source approved' });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/use'))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('provider'))).toBe(false);
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
    expect(screen.getByLabelText('Chest-up artifact ID')).toBeTruthy();
    expect(screen.queryByLabelText('Wardrobe pack name')).toBeNull();
    expect(screen.getByRole('button', { name: 'APPROVE LEVEL 2' })).toBeTruthy();
  });
});
