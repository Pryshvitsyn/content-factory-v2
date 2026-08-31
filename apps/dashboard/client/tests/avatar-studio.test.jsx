import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarStudio, LevelLadder } from '../src/AvatarStudio';

const brand = { id: '11111111-1111-4111-8111-111111111111', name: 'Attune' };
function response(payload, ok = true) { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload }); }

describe('Avatar Studio dashboard', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => response([brand]))); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the Library, Create Avatar and plan-only Test Content screens', async () => {
    render(<AvatarStudio />);
    expect(screen.getByRole('heading', { name: 'Avatar Studio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'LIBRARY' })).toBeTruthy();
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

  it('shows all explicit L0-L7 states and next-level focus', () => {
    render(<LevelLadder avatar={{ currentLevel: 3 }} />);
    expect(screen.getByText('L0')).toBeTruthy(); expect(screen.getByText('L7')).toBeTruthy();
    expect(screen.getByText('MULTISHOT CONTINUITY')).toBeTruthy();
    expect(screen.getAllByText('COMPLETE')).toHaveLength(4);
    expect(screen.getByText('NEXT')).toBeTruthy();
  });
});
