import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { NewProduction, ProductionDetail, ReviewQueue, Providers } from '../src/App';

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

  it('regenerates a V2.7 review item as a separate command without publishing', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Try a quieter ending');
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') {
        expect(url).toBe(`/api/productions/${review.productionId}/regenerate`);
        expect(url).not.toContain('publish');
        return response({ productionId: '44444444-4444-4444-8444-444444444444', requiresExplicitStart: true });
      }
      return response([{ ...review, commandAvailable: true }]);
    });
    render(<ReviewQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'REGENERATE' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/productions/${review.productionId}/regenerate`,
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('Try a quieter ending') })));
  });
});

describe('V2.7 operator console', () => {
  beforeEach(() => { window.location.hash = ''; vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  const brands = [{ id: brandId, name: 'Attune', status: 'ACTIVE' }];
  const providers = [
    { capability: 'FAST RENDERER', provider: 'MoneyPrinterTurbo', configured: true },
    { capability: 'VIDEO', provider: 'Replicate', configured: true },
    { capability: 'SPEECH', provider: 'OpenAI', configured: true },
  ];

  it('renders New Production, loads brands, selects FAST/QUALITY, and disables unavailable renderers', async () => {
    fetch.mockImplementation((url) => response(url === '/api/brands' ? brands : [
      { capability: 'FAST RENDERER', provider: 'MoneyPrinterTurbo', configured: false }, ...providers.slice(1),
    ]));
    render(<NewProduction />);
    expect(await screen.findByRole('heading', { name: 'New Production' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Attune' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /FAST/ }).disabled).toBe(true);
    const quality = screen.getByRole('button', { name: /QUALITY/ });
    expect(quality.disabled).toBe(false); fireEvent.click(quality);
    expect(quality.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Production title').required).toBe(true);
    expect(screen.getByLabelText('Creative brief').required).toBe(true);
  });

  it('renders preflight without starting and exposes a separate explicit Start button', async () => {
    const paths = [];
    const onCreated = vi.fn();
    fetch.mockImplementation((url, options = {}) => {
      paths.push([url, options.method || 'GET']);
      if (url === '/api/brands') return response(brands);
      if (url === '/api/providers') return response(providers);
      if (url === `/api/brands/${brandId}`) return response({ ...brands[0], products: [], audiences: [], offers: [], campaigns: [], knowledge: [] });
      if (url === '/api/productions/preflight') return response({ preflightId: 'fp', brand: 'Attune', production: 'Human moment', renderMode: 'FAST', renderer: 'moneyprinterturbo', targetPlatform: 'Reels', targetDurationSeconds: 10, aspectRatio: '9:16', expectedVideoGenerations: 0, expectedAudioGenerations: 0, expectedExternalExecutions: 1, estimatedCost: null, rendererStatus: 'READY', schemaStatus: 'READY', humanApprovalRequired: true });
      if (url === '/api/productions') return response({ productionId: '22222222-2222-4222-8222-222222222222', brandId, jobStatus: 'QUEUED' });
      if (url.includes('/start')) return response({ accepted: true });
      if (url.includes('/stages') || url.includes('/artifacts')) return response([]);
      if (url === `/api/productions/22222222-2222-4222-8222-222222222222?brandId=${brandId}`) {
        return response({ id: '22222222-2222-4222-8222-222222222222', brandId, brandName: 'Attune',
          title: 'Human moment', renderMode: 'FAST', renderer: 'moneyprinterturbo', status: 'RUNNING',
          jobStatus: 'RUNNING', operationalStatus: 'RUNNING', progress: [], actualProviderCalls: 0,
          ambiguousExecutions: 0, jobError: {}, shotRegenerations: [] });
      }
      throw new Error(`Unexpected ${url}`);
    });
    const view = render(<NewProduction onCreated={onCreated} />);
    fireEvent.change(await screen.findByLabelText('Brand'), { target: { value: brandId } });
    for (const [label, value] of [['Production title','Human moment'],['Hook','Notice first'],['Core message','Attention creates understanding'],['Creative brief','A believable couple pauses'],['CTA','Tune in']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText('Target duration'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'PREPARE / PREFLIGHT' }));
    expect(await screen.findByText('Ready to start')).toBeTruthy();
    expect(screen.getByText('PREFLIGHT READY · PROVIDER EXECUTIONS 0')).toBeTruthy();
    expect(paths.filter(([path, method]) => method === 'POST' && path !== '/api/productions/preflight')).toHaveLength(0);
    const start = screen.getByRole('button', { name: 'START PRODUCTION' });
    expect(start).toBeTruthy(); fireEvent.click(start);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      id: '22222222-2222-4222-8222-222222222222', brandId,
    }));
    expect(paths.some(([path]) => path === '/api/productions')).toBe(true);
    expect(paths.some(([path]) => path.endsWith('/start'))).toBe(true);
    const canonical = onCreated.mock.calls[0][0];
    expect(canonical.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    view.rerender(<ProductionDetail production={canonical} />);
    expect(await screen.findByRole('heading', { name: 'Human moment' })).toBeTruthy();
    expect(paths.filter(([path]) => path === `/api/productions/${canonical.id}?brandId=${brandId}`).length).toBeGreaterThanOrEqual(2);
  });

  it('renders durable progress and keeps Retry distinct from Regenerate', async () => {
    const calls = [];
    vi.spyOn(window, 'prompt').mockReturnValue('Stronger opening');
    fetch.mockImplementation((url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.includes('/stages')) return response([]);
      if (url.includes('/artifacts')) return response([]);
      if (url.endsWith('/retry')) return response({ accepted: true });
      if (url.endsWith('/regenerate')) return response({ productionId: '44444444-4444-4444-8444-444444444444' });
      return response({ id: review.productionId, brandId, brandName: 'Attune', title: 'Failed creative', renderMode: 'QUALITY', renderer: 'v2.5-quality', status: 'RUNNING', jobStatus: 'RETRYING', operationalStatus: 'FAILED_RETRYABLE', canonicalRequest: { title: 'Failed creative' }, progress: [{ key: 'rendering', label: 'Rendering', status: 'FAILED' }], actualProviderCalls: 0, ambiguousExecutions: 0, jobError: { code: 'STORAGE_FAILURE', message: 'Storage failure' } });
    });
    render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    expect(await screen.findByText('FAILED RETRYABLE')).toBeTruthy();
    expect(screen.getByText('Rendering')).toBeTruthy(); expect(screen.getByText('Storage failure')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'RETRY SAME EXECUTION' }));
    await waitFor(() => expect(calls.some(([url]) => url.endsWith('/retry'))).toBe(true));
    expect(calls.some(([url]) => url.endsWith('/regenerate'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE NEW REVISION' }));
    await waitFor(() => expect(calls.some(([url]) => url.endsWith('/regenerate'))).toBe(true));
  });

  it('shows post-render validation failure as completed generation/assembly with review blocked', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/stages') || url.includes('/artifacts')) return response([]);
      return response({ id: review.productionId, brandId, brandName: 'Attune', title: 'Validation failure',
        renderMode: 'QUALITY', renderer: 'v2.5-quality', status: 'RUNNING', jobStatus: 'RETRYING',
        operationalStatus: 'VALIDATION_FAILED', validationStatus: 'FAIL', reviewState: 'BLOCKED',
        progress: [
          { key: 'planning', label: 'Planning', status: 'COMPLETED' },
          { key: 'generation', label: 'Provider Generation', status: 'COMPLETED' },
          { key: 'assembly', label: 'Master Assembly', status: 'COMPLETED' },
          { key: 'validation', label: 'Validation', status: 'FAILED' },
          { key: 'review', label: 'Human Review', status: 'BLOCKED' },
        ], actualProviderCalls: 3, ambiguousExecutions: 0, shotRegenerations: [], jobError: {
          code: 'LIVE_MASTER_VALIDATION_FAILED', message: 'Master failed required quality validation' },
        validationEvidence: { status: 'FAIL', score: 0.929, validationClass: 'POST_RENDER',
          timestamp: '2026-08-26T00:00:00.000Z', masterArtifact: { id: `production:${review.productionId}:master` },
          checks: [{ code: 'voice_copy_integrity', status: 'FAIL', message: 'Planned speech text mismatch.',
            details: { actual: 'hook core cta', expected: 'hook cta' } }] } });
    });
    render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    expect(await screen.findByText('Provider Generation')).toBeTruthy();
    expect(screen.getByText('Master Assembly')).toBeTruthy();
    expect(screen.getByText('Human Review')).toBeTruthy();
    expect(screen.getByText('voice_copy_integrity')).toBeTruthy();
    expect(screen.getByText(/Actual: "hook core cta"/)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('can explicitly start a prepared immutable regeneration from production detail', async () => {
    const calls = [];
    fetch.mockImplementation((url, options = {}) => {
      calls.push([url, options.method || 'GET', options.body]);
      if (url.includes('/stages') || url.includes('/artifacts')) return response([]);
      if (url.endsWith('/start')) return response({ accepted: true });
      return response({ id: review.productionId, brandId, brandName: 'Attune', title: 'Prepared revision',
        renderMode: 'FAST', renderer: 'moneyprinterturbo', status: 'DRAFT', jobStatus: 'QUEUED',
        operationalStatus: 'PREFLIGHT_READY', canonicalRequest: {}, progress: [], actualProviderCalls: 0,
        ambiguousExecutions: 0, jobError: {} });
    });
    render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'START PRODUCTION' }));
    await waitFor(() => expect(calls.some(([url, method, body]) => url.endsWith('/start')
      && method === 'POST' && JSON.parse(body).confirmation === true)).toBe(true));
  });

  it('reloads production truth after a browser remount instead of keeping stale React status', async () => {
    let status = 'RUNNING';
    fetch.mockImplementation((url) => {
      if (url.includes('/stages') || url.includes('/artifacts')) return response([]);
      return response({ id: review.productionId, brandId, brandName: 'Attune', title: 'Refresh proof', renderMode: 'FAST', renderer: 'moneyprinterturbo', status, jobStatus: status, operationalStatus: status, canonicalRequest: {}, progress: [], actualProviderCalls: 0, ambiguousExecutions: 0, jobError: {} });
    });
    const first = render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    expect(await screen.findByText('RUNNING')).toBeTruthy(); first.unmount(); status = 'COMPLETED';
    render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    expect(await screen.findByText('COMPLETED')).toBeTruthy();
  });

  it('preflights one immutable shot revision before explicit cost confirmation', async () => {
    const calls = [];
    vi.spyOn(window, 'prompt').mockReturnValue('Quieter pause');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetch.mockImplementation((url, options = {}) => {
      calls.push([url, options.method || 'GET', options.body]);
      if (url.includes('/stages') || url.includes('/artifacts')) return response([]);
      if (url.endsWith('/preflight')) return response({ preflightId: 'shot-fp', provider: 'replicate',
        model: 'quality/test', resolution: '720p', estimatedCost: null, providerCalls: 0 });
      if (url.endsWith('/regenerate')) return response({ accepted: true, publicationTriggered: false });
      return response({ id: review.productionId, brandId, brandName: 'Attune', title: 'Quality creative',
        renderMode: 'QUALITY', renderer: 'v2.5-quality', status: 'COMPLETED', jobStatus: 'COMPLETED',
        operationalStatus: 'AWAITING_REVIEW', canonicalRequest: {}, progress: [], actualProviderCalls: 3,
        ambiguousExecutions: 0, jobError: {}, shotRegenerations: [], jobPayload: { canonicalRawInput: {
          creative_plan: { shots: [{ shotId: 'operator-shot-1', assetId: 'operator-video-1',
            purpose: 'Create ambiguity', durationSeconds: 5 }] },
        } } });
    });
    render(<ProductionDetail production={{ id: review.productionId, brandId }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'REGENERATE THIS SHOT' }));
    await waitFor(() => expect(calls.some(([url]) => url.endsWith('/shots/operator-shot-1/preflight'))).toBe(true));
    await waitFor(() => expect(calls.some(([url, method, body]) => url.endsWith('/shots/operator-shot-1/regenerate')
      && method === 'POST' && JSON.parse(body).confirmation === true)).toBe(true));
  });
});

describe('V2.8 universal provider controls', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());
  const brands = [{ id: brandId, name: 'Attune', status: 'ACTIVE' }];
  const model = (modelId, displayName, profiles) => ({ modelId, displayName, vendor: 'vendor',
    capabilities: ['TEXT_TO_VIDEO'], profiles, experimental: false });
  const catalog = [
    { id: 'replicate', displayName: 'Replicate', type: 'AGGREGATOR', configured: true, availability: 'CONFIGURED_NOT_PROBED',
      credentialStatus: 'CONFIGURED', modelCount: 1, capabilities: ['TEXT_TO_VIDEO'], models: [model('wan/video','Wan', { ECONOMY: {}, STANDARD: {} })] },
    { id: 'fal', displayName: 'fal.ai', type: 'AGGREGATOR', configured: true, availability: 'CONFIGURED_NOT_PROBED',
      credentialStatus: 'CONFIGURED', modelCount: 1, capabilities: ['TEXT_TO_VIDEO'], models: [model('bytedance/seedance','Seedance', { STANDARD: {}, PREMIUM: {} })] },
    { id: 'runway', displayName: 'Runway', type: 'DIRECT', configured: true, availability: 'CONFIGURED_NOT_PROBED',
      credentialStatus: 'CONFIGURED', modelCount: 1, capabilities: ['TEXT_TO_VIDEO'], models: [model('gen4.5','Gen-4.5', { STANDARD: {} })] },
    { id: 'openai', displayName: 'OpenAI', type: 'DIRECT', configured: true, availability: 'CONFIGURED_NOT_PROBED',
      credentialStatus: 'CONFIGURED', modelCount: 1, capabilities: ['SPEECH'], models: [] },
    { id: 'moneyprinterturbo', displayName: 'MoneyPrinterTurbo', type: 'LOCAL', configured: false, availability: 'NOT_CONFIGURED',
      credentialStatus: 'NOT_CONFIGURED', modelCount: 1, capabilities: ['FAST_RENDER'], models: [] },
  ];

  it('filters provider, model, and model-aware profile dropdowns from the backend catalog', async () => {
    fetch.mockImplementation((url) => response(url === '/api/brands' ? brands : catalog));
    render(<NewProduction />);
    fireEvent.click(await screen.findByRole('button', { name: /QUALITY/ }));
    expect(screen.getByRole('option', { name: 'Replicate' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'fal.ai' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Runway' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'OpenAI' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'fal' } });
    expect(screen.getByRole('option', { name: 'Seedance' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Wan' })).toBeNull();
    expect(screen.getByRole('option', { name: 'PREMIUM' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'runway' } });
    expect(screen.getByRole('option', { name: 'Gen-4.5' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'STANDARD' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'PREMIUM' })).toBeNull();
  });

  it('shows provider health without rendering secret values', async () => {
    fetch.mockImplementation((url) => response(url === '/api/providers' ? catalog : brands));
    const view = render(<Providers />);
    expect(await screen.findByRole('heading', { name: 'fal.ai' })).toBeTruthy();
    expect(screen.getAllByText('CONFIGURED NOT PROBED').length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toContain('synthetic-test-key');
    expect(screen.getByRole('button', { name: 'ADD MODEL' })).toBeTruthy();
  });
});
