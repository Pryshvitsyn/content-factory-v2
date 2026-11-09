import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PilotReview } from '../src/PilotReview';

const saved = { attemptId: 'attempt-1', state: 'FIRST_VIDEO_REVIEW', status: 'SUCCEEDED',
  contentUrl: '/api/v2.10/creative-drafts/d/pilot/a/content?brandId=b', canApprove: true, canReject: true,
  quality: { status: 'WARN', checks: [{ code: 'PROP_NOT_VISIBLE', status: 'WARN', reason: 'Bag placement is not visible.' }] } };

describe('saved pilot review', () => {
  it('restores the exact video and warning on mount; approval waits for playable media', () => {
    const onDecision = vi.fn();
    render(<PilotReview review={saved} onDecision={onDecision} />);
    const video = screen.getByLabelText('Saved pilot video');
    expect(video.getAttribute('src')).toBe(saved.contentUrl);
    expect(screen.getByText(/Bag placement/)).toBeTruthy();
    const approve = screen.getByRole('button', { name: 'APPROVE LOOK & MOTION' });
    expect(approve.disabled).toBe(true);
    fireEvent.loadedData(video);
    expect(approve.disabled).toBe(false);
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(approve);
    expect(onDecision).toHaveBeenCalledWith('approve');
  });
  it('resets playability for a different immutable attempt and reports playback failure', () => {
    const { rerender } = render(<PilotReview review={saved} />);
    fireEvent.loadedData(screen.getByLabelText('Saved pilot video'));
    rerender(<PilotReview review={{ ...saved, contentUrl: saved.contentUrl + '&revision=2' }} />);
    expect(screen.getByRole('button', { name: 'APPROVE LOOK & MOTION' }).disabled).toBe(true);
    fireEvent.error(screen.getByLabelText('Saved pilot video'));
    expect(screen.getByRole('alert').textContent).toContain('Do not generate another pilot');
  });
  it('offers saved-result recovery without approval or generation', () => {
    const onRestore = vi.fn();
    render(<PilotReview review={{ ...saved, state: 'FIRST_VIDEO_RUNNING', canApprove: false, canReject: false, canRestoreReview: true }} onRestore={onRestore} />);
    fireEvent.loadedData(screen.getByLabelText('Saved pilot video'));
    expect(screen.getByRole('button', { name: 'APPROVE LOOK & MOTION' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'RESTORE SAVED REVIEW · 0 CALLS' }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
  it('leaves approval disabled for rejected/failed media and displays the next step after acceptance', () => {
    const { rerender } = render(<PilotReview review={{ ...saved, state: 'FIRST_VIDEO_FAILED', canApprove: false }} />);
    fireEvent.loadedData(screen.getByLabelText('Saved pilot video'));
    expect(screen.getByRole('button', { name: 'APPROVE LOOK & MOTION' }).disabled).toBe(true);
    rerender(<PilotReview review={{ ...saved, state: 'FIRST_VIDEO_ACCEPTED', canApprove: false, canReject: false }} />);
    expect(screen.getByText(/Run a fresh final production preflight/)).toBeTruthy();
  });
});
