import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { ReviewQueue } from '../src/App';

const brandId = '11111111-1111-4111-8111-111111111111';
const review = {
  id: '33333333-3333-4333-8333-333333333333', brandId, brandName: 'Acme',
  productionId: '22222222-2222-4222-8222-222222222222', productionName: 'Launch master',
  artifactId: 'production:master', artifactVersion: 1, contentType: 'video/mp4', validationStatus: 'PASS',
  productionStatus: 'COMPLETED', reviewStatus: 'AWAITING_HUMAN_APPROVAL', publicationStatus: 'DISABLED_PENDING_APPROVAL',
  renderMode: 'FAST', renderer: 'moneyprinterturbo', rendererStatus: 'SUCCEEDED',
  reviewPayload: { hook: 'Stop scrolling', cta: 'Start now', durationMs: 5000, width: 1080, height: 1920,
    videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, script: { scenes: [] }, technicalValidation: [] },
  validationEvidence: { status: 'PASS', score: 1 }, provenance: { provider: 'ffmpeg' },
  generatedAssets: [{ assetId: 'video-1', kind: 'video', provider: 'replicate', model: 'wan-test', durationMs: 5000 }],
};

function response(payload, ok = true) { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload }); }

describe('V2.3 dashboard', () => {
  beforeEach(() => { window.location.hash = ''; vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the five operational sections and live overview values', async () => {
    fetch.mockImplementation((url) => url === '/api/overview'
      ? response({ totalBrands: 2, activeProductions: 1, queuedJobs: 3, runningJobs: 1, failedJobs: 0, awaitingReview: 1, recentlyCompleted: 4, recentActivity: [] })
      : response([{ configured: true }]));
    render(<App />);
    for (const label of ['Overview','Brands','Productions','Review Queue','Providers']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.getByText('Awaiting review')).toBeTruthy();
  });

  it('renders exact-master review data and approves without publication', async () => {
    let reviewed = false;
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') {
        reviewed = true;
        expect(url).toContain(`/api/reviews/${review.id}/approve`);
        expect(url).not.toContain('publish');
        return response({ decision: 'APPROVED' });
      }
      return response(reviewed ? [] : [review]);
    });
    render(<ReviewQueue />);
    expect(await screen.findByText('Launch master')).toBeTruthy();
    expect(screen.getByText('Stop scrolling')).toBeTruthy();
    expect(screen.getByText('DISABLED_PENDING_APPROVAL')).toBeTruthy();
    expect(screen.getByText('FAST')).toBeTruthy();
    expect(screen.getByText('moneyprinterturbo · SUCCEEDED')).toBeTruthy();
    expect(screen.getByText(/video · video-1 · replicate \/ wan-test/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/reviews/${review.id}/approve`, expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('No validated masters are awaiting human review.')).toBeTruthy();
  });

  it('requires a rejection reason before sending the decision', async () => {
    fetch.mockImplementation(() => response([review]));
    vi.spyOn(window, 'prompt').mockReturnValue('CTA mismatch');
    render(<ReviewQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'REJECT' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/reviews/${review.id}/reject`, expect.objectContaining({ body: expect.stringContaining('CTA mismatch') })));
  });
});
