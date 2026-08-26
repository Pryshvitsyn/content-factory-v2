import React, { useEffect, useMemo, useState } from 'react';
import { api, artifactUrl, decideReview } from './api';

const NAV = ['Overview', 'New Production', 'Productions', 'Review Queue', 'Brands', 'Providers / Renderers'];
const TERMINAL = new Set(['APPROVED','REJECTED','FAILED','VALIDATION_FAILED','COMPLETED','CANCELLED']);

function commandId() { return globalThis.crypto?.randomUUID?.() || '11111111-1111-4111-8111-111111111111'; }

function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState((current) => ({ ...current, loading: current.data === null, error: null }));
    loader().then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => live && setState({ loading: false, data: null, error: error.message }));
    return () => { live = false; };
  }, dependencies);
  return state;
}

function State({ state, children }) {
  if (state.loading && state.data === null) return <div className="empty">Loading persisted state…</div>;
  if (state.error) return <div className="error-panel">{state.error}</div>;
  return children(state.data);
}

export function Badge({ value = 'NOT_STARTED' }) {
  return <span className={`badge badge-${String(value).toLowerCase()}`}>{String(value).replaceAll('_', ' ')}</span>;
}

function Overview({ navigate }) {
  const state = useLoad(() => Promise.all([
    api('/api/overview'), api('/api/providers'), api('/api/productions'), api('/api/reviews'),
  ]).then(([overview, providers, productions, reviews]) => ({ overview, providers, productions, reviews })));
  return <Page title="Overview" eyebrow="OPERATOR CONTROL PLANE"><State state={state}>{({ overview, providers, productions, reviews }) => <>
    <div className="metric-grid">{[
      ['Active productions', overview.activeProductions], ['Awaiting review', overview.awaitingReview],
      ['Failed / attention', overview.failedJobs], ['Completed today', overview.completedToday ?? 0],
      ['Brands', overview.totalBrands],
    ].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="overview-actions"><button className="primary" onClick={() => navigate('New Production')}>NEW PRODUCTION</button></div>
    <div className="overview-grid">
      <Section title="Recent productions">{productions.length ? productions.slice(0, 6).map((item, index) => <button className="row-button" key={item.id || `recent-${index}`} onClick={() => navigate('Productions', item)}><span><strong>{item.title || item.name}</strong><small>{item.brandName} · {formatDate(item.createdAt)}</small></span><Badge value={item.operationalStatus || item.status} /></button>) : <Empty text="No productions yet." />}</Section>
      <Section title="Needs attention">{productions.filter((item) => ['FAILED','FAILED_RETRYABLE','VALIDATION_FAILED'].includes(item.operationalStatus)).length ? productions.filter((item) => ['FAILED','FAILED_RETRYABLE','VALIDATION_FAILED'].includes(item.operationalStatus)).slice(0, 5).map((item) => <p key={item.id}>{item.title} · <Badge value={item.operationalStatus} /></p>) : <Empty text="No failed productions." />}</Section>
      <Section title="Review queue">{reviews.length ? reviews.slice(0, 4).map((item, index) => <p key={item.id || `review-${index}`}>{item.brandName} · {item.productionName}</p>) : <Empty text="Nothing awaiting review." />}</Section>
      <Section title="Provider availability">{providers.slice(0, 7).map((item, index) => <p key={item.id || `${item.provider}-${index}`}>{item.displayName || item.provider} <Badge value={item.availability} /></p>)}</Section>
    </div>
  </>}</State></Page>;
}

export function NewProduction({ onCreated = () => {} }) {
  const catalog = useLoad(() => Promise.all([api('/api/brands'), api('/api/providers')]).then(([brands, providers]) => ({ brands, providers })));
  const [requestId] = useState(commandId);
  const [form, setForm] = useState({ requestId, brandId: '', renderMode: 'FAST', title: '', objective: 'ENGAGEMENT',
    provider: '', model: '', profile: '',
    platform: 'Instagram Reels', targetDurationSeconds: 15, aspectRatio: '9:16', hook: '', coreMessage: '', creativeBrief: '', cta: '',
    voiceover: '', sceneIdeas: '', visualDirection: '', captionsEnabled: true, musicEnabled: false,
    audience: '', campaign: '', additionalInstructions: '' });
  const [brand, setBrand] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let live = true;
    if (!form.brandId) { setBrand(null); return () => { live = false; }; }
    api(`/api/brands/${form.brandId}`).then((value) => live && setBrand(value)).catch(() => live && setBrand(null));
    return () => { live = false; };
  }, [form.brandId]);

  function change(name, value) { setForm((current) => ({ ...current, [name]: value })); setPreflight(null); }
  async function prepare(event) {
    event.preventDefault(); setBusy('preflight'); setError(null); setPreflight(null);
    try { setPreflight(await api('/api/productions/preflight', { method: 'POST', body: JSON.stringify(form) })); }
    catch (failure) { setError(failure); } finally { setBusy(null); }
  }
  async function start() {
    setBusy('start'); setError(null);
    try {
      const created = await api('/api/productions', { method: 'POST', body: JSON.stringify({ request: form, preflightId: preflight.preflightId }) });
      await api(`/api/productions/${created.productionId}/start`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, confirmation: true }) });
      const canonical = await api(`/api/productions/${created.productionId}?brandId=${form.brandId}`);
      onCreated(canonical);
    } catch (failure) { setError(failure); } finally { setBusy(null); }
  }

  return <Page title="New Production" eyebrow="SIMPLE MODE · CANONICAL INPUT">
    <p className="page-note">Choose a brand and renderer, describe the creative, then preflight. Preflight never starts production.</p>
    {error ? <div className="error-panel"><strong>{error.code || 'PREFLIGHT_FAILED'}</strong><p>{error.message || String(error)}</p><ValidationDetails evidence={error.details?.validation} /></div> : null}
    <State state={catalog}>{({ brands, providers }) => {
      const catalogProviders = providers.filter((item) => item.id && Array.isArray(item.models));
      const fastReady = providers.some((item) => (item.id === 'moneyprinterturbo' || item.capability === 'FAST RENDERER') && item.configured);
      const speechReady = catalogProviders.length ? providers.some((item) => item.id === 'openai' && item.configured)
        : providers.some((item) => item.capability === 'SPEECH' && item.configured);
      const qualityProviders = catalogProviders.filter((item) => item.configured
        && item.models.some((model) => model.capabilities?.includes('TEXT_TO_VIDEO') && model.selectable !== false));
      const qualityReady = catalogProviders.length ? qualityProviders.length > 0 && speechReady
        : providers.some((item) => item.capability === 'VIDEO' && item.provider === 'Replicate' && item.configured) && speechReady;
      const selectedProvider = catalogProviders.find((item) => item.id === form.provider);
      const selectedModels = (selectedProvider?.models || []).filter((model) => model.capabilities?.includes('TEXT_TO_VIDEO'));
      const selectedModel = selectedModels.find((model) => model.modelId === form.model);
      const selectedProfiles = Object.keys(selectedModel?.profiles || {});
      const selectQuality = () => {
        const route = qualityProviders[0]; const model = route?.models.find((item) => item.capabilities?.includes('TEXT_TO_VIDEO') && item.selectable !== false);
        setForm((current) => ({ ...current, renderMode: 'QUALITY', captionsEnabled: false,
          provider: current.provider || route?.id || '', model: current.model || model?.modelId || '',
          profile: current.profile || Object.keys(model?.profiles || {})[0] || '' })); setPreflight(null);
      };
      return <form className="production-form" onSubmit={prepare}>
        <Section title="1 · Production route">
          <label>Brand<select aria-label="Brand" required value={form.brandId} onChange={(event) => change('brandId', event.target.value)}><option value="">Choose a canonical brand</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="mode-grid">
            <ModeCard mode="FAST" selected={form.renderMode === 'FAST'} available={fastReady} onSelect={() => change('renderMode', 'FAST')} description="Best for high-volume, stock/template-based social creative." unavailable="MoneyPrinterTurbo is not configured" />
            <ModeCard mode="QUALITY" selected={form.renderMode === 'QUALITY'} available={qualityReady} onSelect={selectQuality} description="AI-generated visual production with an explicit provider, model, and profile." unavailable="No configured production video route or speech provider" />
          </div>
          {form.renderMode === 'QUALITY' && catalogProviders.length ? <div className="form-grid routing-fields">
            <label>Provider<select aria-label="Provider" required value={form.provider} onChange={(event) => {
              const route = catalogProviders.find((item) => item.id === event.target.value);
              const model = route?.models.find((item) => item.capabilities?.includes('TEXT_TO_VIDEO') && item.selectable !== false);
              setForm((current) => ({ ...current, provider: event.target.value, model: model?.modelId || '', profile: Object.keys(model?.profiles || {})[0] || '' })); setPreflight(null);
            }}><option value="">Choose provider</option>{qualityProviders.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
            <label>Model<select aria-label="Model" required value={form.model} onChange={(event) => {
              const model = selectedModels.find((item) => item.modelId === event.target.value);
              setForm((current) => ({ ...current, model: event.target.value, profile: Object.keys(model?.profiles || {})[0] || '' })); setPreflight(null);
            }}><option value="">Choose model</option>{selectedModels.filter((item) => item.selectable !== false).map((item) => <option key={item.modelId} value={item.modelId}>{item.displayName}</option>)}</select></label>
            <label>Profile<select aria-label="Profile" required value={form.profile} onChange={(event) => change('profile', event.target.value)}><option value="">Choose profile</option>{selectedProfiles.map((name) => <option key={name}>{name}</option>)}</select></label>
          </div> : null}
          {brand ? <div className="brand-context"><strong>{brand.name} Brand Brain</strong><span>{brand.positioning || brand.mission || 'No Brand Brain context recorded. Operator brief remains authoritative.'}</span></div> : null}
        </Section>
        <Section title="2 · Creative brief"><div className="form-grid">
          <Field label="Production title" name="title" value={form.title} change={change} required />
          <label>Objective<select aria-label="Objective" value={form.objective} onChange={(event) => change('objective', event.target.value)}>{['ENGAGEMENT','ORGANIC_REACH','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','RETENTION','EXPERIMENT'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <Field label="Platform" name="platform" value={form.platform} change={change} required />
          <label>Target duration<input aria-label="Target duration" type="number" min="3" max="60" value={form.targetDurationSeconds} onChange={(event) => change('targetDurationSeconds', Number(event.target.value))} required /></label>
          <label>Aspect ratio<select aria-label="Aspect ratio" value={form.aspectRatio} onChange={(event) => change('aspectRatio', event.target.value)}><option>9:16</option></select></label>
          <Field label="Hook" name="hook" value={form.hook} change={change} required />
          <TextField label="Core message" name="coreMessage" value={form.coreMessage} change={change} required />
          <TextField label="Creative brief" name="creativeBrief" value={form.creativeBrief} change={change} required />
          <Field label="CTA" name="cta" value={form.cta} change={change} required />
        </div></Section>
        <button className="advanced-toggle" type="button" onClick={() => setAdvanced(!advanced)}>Advanced {advanced ? '−' : '+'}</button>
        {advanced ? <Section title="Advanced creative controls"><div className="form-grid">
          <TextField label="Voiceover" name="voiceover" value={form.voiceover} change={change} /><TextField label="Scene ideas" name="sceneIdeas" value={form.sceneIdeas} change={change} /><TextField label="Visual direction" name="visualDirection" value={form.visualDirection} change={change} />
          <Field label="Audience" name="audience" value={form.audience} change={change} /><Field label="Campaign" name="campaign" value={form.campaign} change={change} /><TextField label="Additional instructions" name="additionalInstructions" value={form.additionalInstructions} change={change} />
          <label className="check"><input aria-label="Captions" type="checkbox" checked={form.captionsEnabled} disabled={form.renderMode !== 'FAST'} onChange={(event) => change('captionsEnabled', event.target.checked)} /> Captions {form.renderMode === 'FAST' ? 'burned by FAST renderer' : 'not rendered by QUALITY master'}</label>
          <label className="check"><input aria-label="Music" type="checkbox" checked={form.musicEnabled} onChange={(event) => change('musicEnabled', event.target.checked)} /> Music / ambience intent (cost unknown)</label>
        </div></Section> : null}
        <button className="primary full" type="submit" disabled={busy || !form.brandId || (form.renderMode === 'FAST' ? !fastReady : !qualityReady)}>{busy === 'preflight' ? 'PREFLIGHTING…' : 'PREPARE / PREFLIGHT'}</button>
        {preflight ? <Preflight plan={preflight} busy={busy === 'start'} onStart={start} /> : null}
      </form>;
    }}</State>
  </Page>;
}

function ModeCard({ mode, selected, available, onSelect, description, unavailable }) {
  return <button type="button" className={`mode-card ${selected ? 'selected' : ''}`} disabled={!available} onClick={onSelect} aria-pressed={selected}><span><strong>{mode}</strong><Badge value={available ? 'READY' : 'UNAVAILABLE'} /></span><p>{description}</p>{!available ? <small>{unavailable}</small> : <small>Estimated cost: UNKNOWN</small>}</button>;
}

function Preflight({ plan, onStart, busy }) {
  return <section className="preflight"><span className="eyebrow">PREFLIGHT READY · PROVIDER EXECUTIONS 0</span><h2>Ready to start</h2><div className="plan-grid">
    <KeyValue label="Brand" value={plan.brand} /><KeyValue label="Production" value={plan.production} /><KeyValue label="Mode / renderer" value={`${plan.renderMode} · ${plan.renderer}`} /><KeyValue label="Provider / model" value={[plan.provider, plan.vendor, plan.model].filter(Boolean).join(' · ')} /><KeyValue label="Profile / capability" value={[plan.profile, plan.capability].filter(Boolean).join(' · ')} /><KeyValue label="Resolution / quality" value={[plan.resolution, plan.qualityMode].filter(Boolean).join(' · ')} /><KeyValue label="Configuration" value={plan.configurationStatus} /><KeyValue label="Prompt optimization" value={plan.promptOptimization == null ? 'N/A' : plan.promptOptimization ? 'ENABLED' : 'DISABLED'} /><KeyValue label="Platform" value={plan.targetPlatform} /><KeyValue label="Master" value={`${plan.targetDurationSeconds} sec · ${plan.aspectRatio}`} /><KeyValue label="Expected generations" value={`${plan.expectedVideoGenerations} video · ${plan.expectedAudioGenerations} audio`} /><KeyValue label="External executions" value={String(plan.expectedExternalExecutions)} /><KeyValue label="Estimated cost" value={plan.estimatedCost ?? 'UNKNOWN'} /><KeyValue label="Renderer" value={plan.rendererStatus} /><KeyValue label="Schema" value={plan.schemaStatus} /><KeyValue label="Human approval" value={plan.humanApprovalRequired ? 'REQUIRED' : 'NO'} /><KeyValue label="Auto publish" value="NO" />
  </div><p className="boundary">Starting may cross an external cost boundary. Approval of the final master will not publish it.</p><button className="start" type="button" disabled={busy} onClick={onStart}>{busy ? 'STARTING…' : 'START PRODUCTION'}</button></section>;
}

function Brands() {
  const [selected, setSelected] = useState(null); const list = useLoad(() => api('/api/brands')); const detail = useLoad(() => selected ? api(`/api/brands/${selected}`) : Promise.resolve(null), [selected]);
  return <Page title="Brands" eyebrow="CANONICAL WORKSPACE SCOPE"><div className="split"><Section title="Brand portfolio"><State state={list}>{(brands) => brands.length ? brands.map((brand) => <button className={`row-button ${selected === brand.id ? 'selected' : ''}`} key={brand.id} onClick={() => setSelected(brand.id)}><span><strong>{brand.name}</strong><small>{brand.id}</small></span><Badge value={brand.status} /></button>) : <Empty text="No brands in the configured database." />}</State></Section><Section title="Brand Brain"><State state={detail}>{(brand) => brand ? <BrandDetail brand={brand} /> : <Empty text="Select a brand." />}</State></Section></div></Page>;
}

function BrandDetail({ brand }) {
  const groups = brand.knowledge.reduce((result, item) => ({ ...result, [item.knowledgeType]: [...(result[item.knowledgeType] || []), item] }), {});
  return <div className="detail-stack"><div className="detail-head"><div><h3>{brand.name}</h3><code>{brand.id}</code></div><Badge value={brand.status} /></div><KeyValue label="Mission" value={brand.mission} /><KeyValue label="Positioning" value={brand.positioning} /><Collection title="Products" items={brand.products} render={(item) => `${item.name} · ${item.valueProposition || item.productType}`} /><Collection title="Audiences" items={brand.audiences} render={(item) => `${item.name} · ${item.problemStatement || 'No problem statement'}`} /><Collection title="Offers" items={brand.offers} render={(item) => `${item.name} · ${item.cta || 'No CTA'}`} /><Collection title="Campaigns" items={brand.campaigns} render={(item) => `${item.name} · ${item.objective}`} />{Object.entries(groups).map(([name, items]) => <Collection key={name} title={name.replaceAll('_', ' ')} items={items} render={(item) => JSON.stringify(item.content)} />)}</div>;
}

function Productions({ initialProduction = null }) {
  const brands = useLoad(() => api('/api/brands')); const [filters, setFilters] = useState({ brandId: '', status: '', renderMode: '', needsReview: false, failed: false }); const [selected, setSelected] = useState(initialProduction);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value))); const list = useLoad(() => api(`/api/productions?${query}`), [filters.brandId, filters.status, filters.renderMode, filters.needsReview, filters.failed]);
  return <Page title="Productions" eyebrow="DURABLE EXECUTION TRUTH">{selected ? <ProductionDetail production={selected} onBack={() => setSelected(null)} /> : <><div className="filters"><State state={brands}>{(items) => <select aria-label="Brand filter" value={filters.brandId} onChange={(event) => setFilters({ ...filters, brandId: event.target.value })}><option value="">All brands</option>{items.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select>}</State><select aria-label="Status filter" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All states</option>{['DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED'].map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Render mode filter" value={filters.renderMode} onChange={(event) => setFilters({ ...filters, renderMode: event.target.value })}><option value="">FAST + QUALITY</option><option>FAST</option><option>QUALITY</option></select><label className="check"><input type="checkbox" checked={filters.needsReview} onChange={(event) => setFilters({ ...filters, needsReview: event.target.checked })} /> Needs review</label><label className="check"><input type="checkbox" checked={filters.failed} onChange={(event) => setFilters({ ...filters, failed: event.target.checked })} /> Failed</label></div>
    <Section title="Newest first"><State state={list}>{(items) => items.length ? <div className="table-wrap"><table><thead><tr><th>Production</th><th>Brand</th><th>Mode / renderer</th><th>Progress</th><th>Status</th><th>Review</th><th>Publication</th><th>Created</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => setSelected(item)}><td><strong>{item.title || item.name}</strong><small>{item.targetDurationSeconds ? `${item.targetDurationSeconds}s · ` : ''}{item.id}</small></td><td>{item.brandName || 'Unscoped legacy'}</td><td><Badge value={item.renderMode || 'QUALITY'} /><small>{item.renderer || 'v2.5-quality'}</small></td><td>{item.currentStage || item.jobStatus || '—'}</td><td><Badge value={item.operationalStatus || item.status} />{item.error?.code ? <small>⚠ {item.error.code}</small> : null}</td><td>{item.reviewState ? <Badge value={item.reviewState} /> : '—'}</td><td><Badge value={item.publicationStatus || 'NOT_CONFIGURED'} /></td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <Empty text="No productions match the filters." />}</State></Section></>}</Page>;
}

export function ProductionDetail({ production, onBack = () => {} }) {
  const [revision, setRevision] = useState(0); const [action, setAction] = useState(null); const [message, setMessage] = useState(null); const scope = `?brandId=${production.brandId}`;
  const state = useLoad(() => Promise.all([api(`/api/productions/${production.id}${scope}`), api(`/api/productions/${production.id}/stages${scope}`), api(`/api/productions/${production.id}/artifacts${scope}`)]).then(([item, stages, artifacts]) => ({ item, stages, artifacts })), [production.id, revision]);
  useEffect(() => { const activeShotRevision = state.data?.item?.shotRegenerations?.some((entry) => ['PREPARED','RUNNING','RETRYING'].includes(entry.status)); if (!state.data || (TERMINAL.has(state.data.item.operationalStatus) && !activeShotRevision)) return undefined; const timer = setInterval(() => setRevision((value) => value + 1), 5000); return () => clearInterval(timer); }, [state.data?.item?.operationalStatus, state.data?.item?.shotRegenerations]);
  async function start(item) { setAction('start'); setMessage(null); try { await api(`/api/productions/${item.id}/start`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, confirmation: true }) }); setMessage('Production start accepted. Progress now comes from durable backend state.'); setRevision((v) => v + 1); } catch (error) { setMessage(error.message); } finally { setAction(null); } }
  async function retry(item) { setAction('retry'); setMessage(null); try { await api(`/api/productions/${item.id}/retry`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId }) }); setMessage('Technical retry accepted. This is the same intended execution.'); setRevision((v) => v + 1); } catch (error) { setMessage(error.message); } finally { setAction(null); } }
  async function regenerate(item) { const reason = window.prompt('Optional regeneration instruction') || null; setAction('regenerate'); setMessage(null); try { const result = await api(`/api/productions/${item.id}/regenerate`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, requestId: commandId(), reason }) }); setMessage(`New immutable revision created: ${result.productionId}. It requires its own explicit Start and review.`); } catch (error) { setMessage(error.message); } finally { setAction(null); } }
  async function regenerateShot(item, shot) {
    const instruction = window.prompt(`Regeneration instruction for ${shot.shotId}`) || null;
    const requestId = commandId(); setAction(`shot:${shot.shotId}`); setMessage(null);
    try {
      const path = `/api/productions/${item.id}/shots/${shot.shotId}`;
      const plan = await api(`${path}/preflight`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, requestId, instruction }) });
      const approved = window.confirm(`Generate 1 video with ${plan.provider}/${plan.model} at ${plan.resolution}. Cost: ${plan.estimatedCost ?? 'UNKNOWN'}. Continue?`);
      if (!approved) { setMessage('Per-shot regeneration cancelled before any provider call.'); return; }
      await api(`${path}/regenerate`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, requestId,
        instruction, preflightId: plan.preflightId, confirmation: true }) });
      setMessage(`Shot ${shot.shotId} revision accepted. The previous asset and master are preserved; the rebuilt master requires human approval.`);
      setRevision((value) => value + 1);
    } catch (error) { setMessage(error.message); } finally { setAction(null); }
  }
  return <State state={state}>{({ item, stages, artifacts }) => <><button className="back" onClick={onBack}>← All productions</button><div className="detail-head"><div><span className="eyebrow">{item.brandName}</span><h2>{item.title || item.name}</h2><code>{item.id}</code></div><Badge value={item.operationalStatus} /></div><p className="page-note">{item.renderMode} · {item.renderer} · Publication: NOT TRIGGERED</p>{message ? <div className="notice">{message}</div> : null}
    <Section title="Progress"><div className="progress-line">{item.progress.map((stage) => <article key={stage.key}><span>{stage.status === 'COMPLETED' ? '✓' : stage.status === 'RUNNING' ? '●' : ['FAILED','BLOCKED'].includes(stage.status) ? '!' : '—'}</span><strong>{stage.label}</strong><Badge value={stage.status} /></article>)}</div></Section>
    <div className="detail-columns"><Section title="Creative input"><pre className="canonical">{JSON.stringify(item.jobPayload?.canonicalRawInput || item.canonicalRequest || {}, null, 2)}</pre></Section><Section title="Validation & cost"><KeyValue label="Validation" value={item.validationStatus} /><KeyValue label="Actual external requests" value={String(item.actualProviderCalls ?? 0)} /><KeyValue label="Known cost" value="UNKNOWN" /><KeyValue label="Human review" value={item.reviewState} /><KeyValue label="Auto publish" value="NO" /><ValidationDetails evidence={item.validationEvidence || item.reviewPayload?.technicalValidation} /></Section></div>
    <Section title="Master & generated assets"><div className="artifact-grid">{artifacts.length ? artifacts.map((artifact) => <ArtifactCard artifact={artifact} key={`${artifact.sourceId}-${artifact.artifactId}`} />) : <Empty text="No safely scoped artifacts yet." />}</div></Section>
    {item.renderMode === 'QUALITY' ? <Section title="Creative plan & shot revisions"><div className="collection">{(item.jobPayload?.canonicalRawInput?.creative_plan?.shots || []).map((shot) => <article className="row-button" key={shot.shotId}><span><strong>{shot.shotId} · {shot.purpose}</strong><small>{shot.durationSeconds}s · {shot.assetId}</small></span><button className="regenerate" disabled={action || ['RUNNING','QUEUED'].includes(item.jobStatus) || item.ambiguousExecutions > 0} onClick={() => regenerateShot(item, shot)}>REGENERATE THIS SHOT</button></article>)}{item.shotRegenerations?.length ? <Collection title="Immutable revision history" items={item.shotRegenerations} render={(entry) => `${entry.shotId} · revision ${entry.revisionNo} · ${entry.replacementAssetId} · ${entry.status}`} /> : null}</div></Section> : null}
    <Section title="Engine detail"><div className="pipeline">{stages.map((stage) => <article className="stage" key={stage.stage}><span>{String(stage.sequence).padStart(2, '0')}</span><strong>{stage.stage}</strong><Badge value={stage.status || 'NOT_STARTED'} /><small>Attempt {stage.attempt || '—'} · {stage.provider || 'provider n/a'} / {stage.model || 'model n/a'}</small>{Object.keys(stage.error || {}).length ? <pre>{JSON.stringify(stage.error, null, 2)}</pre> : null}</article>)}</div></Section>
    {Object.keys(item.jobError || {}).length ? <Section title="Errors / recovery"><div className="error-panel"><strong>{item.jobError.code || 'Production failed'}</strong><p>{item.jobError.message || 'See diagnostics.'}</p></div></Section> : null}<div className="actions detail-actions">{item.status === 'DRAFT' && item.jobStatus === 'QUEUED' ? <button className="start" disabled={action} title="Explicitly start this prepared production" onClick={() => start(item)}>START PRODUCTION</button> : null}<button className="secondary" disabled={action || item.jobStatus !== 'RETRYING'} title="Retry continues the same technical execution" onClick={() => retry(item)}>RETRY SAME EXECUTION</button><button className="regenerate" disabled={action || ['RUNNING','QUEUED'].includes(item.jobStatus) || item.ambiguousExecutions > 0} title="Regenerate creates a new immutable production" onClick={() => regenerate(item)}>REGENERATE NEW REVISION</button></div>
  </>}</State>;
}

function ArtifactCard({ artifact }) {
  const url = artifactUrl(artifact); const media = artifact.contentType?.startsWith('video/') ? <video controls preload="metadata" src={url} /> : artifact.contentType?.startsWith('image/') ? <img src={url} alt={artifact.artifactId} /> : artifact.contentType?.startsWith('audio/') ? <audio controls preload="metadata" src={url} /> : null;
  return <article className="artifact-card">{media}<strong>{artifact.type}</strong><code>{artifact.artifactId}</code><small>v{artifact.version} · {formatDate(artifact.createdAt)}</small><Badge value={artifact.reviewState || artifact.validationStatus} /><small>{artifact.provenance?.provider || artifact.provenance?.renderer || 'provider n/a'} / {artifact.provenance?.model || 'model n/a'}</small></article>;
}

function ValidationDetails({ evidence }) {
  if (!evidence) return null;
  const checks = Array.isArray(evidence.checks) ? evidence.checks : Array.isArray(evidence) ? evidence : [];
  return <details open={evidence.status === 'FAIL'}><summary>Structured validation details</summary>
    <div className="validation-summary"><KeyValue label="Status / score" value={`${evidence.status || 'RECORDED'} · ${evidence.score ?? 'n/a'}`} /><KeyValue label="Class" value={evidence.validationClass} /><KeyValue label="Timestamp" value={formatDate(evidence.timestamp)} /><KeyValue label="Master artifact" value={evidence.masterArtifact?.id} /></div>
    {checks.map((check) => <article className="validation-check" key={check.code}><div><code>{check.code}</code><Badge value={check.status} /></div><p>{check.message}</p><small>Actual: {JSON.stringify(check.details?.actual ?? check.details?.actualMs ?? null)}</small><small>Expected: {JSON.stringify(check.details?.expected ?? check.details?.expectedMs ?? null)}</small></article>)}
  </details>;
}

export function ReviewQueue() {
  const [revision, setRevision] = useState(0); const state = useLoad(() => api('/api/reviews'), [revision]); const [busy, setBusy] = useState(null); const [error, setError] = useState(null);
  async function decide(item, decision) { const reason = decision === 'reject' ? window.prompt('Rejection reason') : null; if (decision === 'reject' && !reason) return; setBusy(item.id); setError(null); try { await decideReview(item, decision, reason); setRevision((value) => value + 1); } catch (failure) { setError(failure.message); } finally { setBusy(null); } }
  async function regenerate(item) { const reason = window.prompt('Optional regeneration instruction') || null; setBusy(item.id); setError(null); try { await api(`/api/productions/${item.productionId}/regenerate`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, requestId: commandId(), reason }) }); setRevision((v) => v + 1); } catch (failure) { setError(failure.message); } finally { setBusy(null); } }
  return <Page title="Review Queue" eyebrow="EXACT IMMUTABLE MASTER"><p className="page-note">Approval applies only to the exact master shown. APPROVE never publishes.</p>{error ? <div className="error-panel">{error}</div> : null}<State state={state}>{(items) => items.length ? <div className="review-grid">{items.map((item) => <article className="review-card" key={item.id}><video controls preload="metadata" src={artifactUrl({ ...item, sourceId: item.id, version: item.artifactVersion })} /><div className="review-body"><div className="detail-head"><div><span className="eyebrow">{item.brandName}</span><h2>{item.productionName}</h2></div><Badge value="AWAITING_HUMAN_APPROVAL" /></div><code>{item.artifactId} · v{item.artifactVersion}</code><div className="review-copy"><KeyValue label="Hook" value={item.reviewPayload?.hook} /><KeyValue label="CTA" value={item.reviewPayload?.cta} /><KeyValue label="Duration" value={item.reviewPayload?.durationMs ? `${item.reviewPayload.durationMs / 1000}s` : null} /><KeyValue label="Quality" value={`${item.validationEvidence?.status || item.validationStatus} · ${item.validationEvidence?.score ?? 'n/a'}`} /><KeyValue label="Mode" value={item.renderMode} /><KeyValue label="Renderer" value={`${item.renderer} · ${item.rendererStatus}`} /><KeyValue label="Publication" value={item.publicationStatus || 'NOT TRIGGERED'} /><KeyValue label="Master media" value={`${item.reviewPayload?.width || '?'}×${item.reviewPayload?.height || '?'} · ${item.reviewPayload?.videoCodec || 'video n/a'} / ${item.reviewPayload?.audioCodec || 'audio n/a'}`} /></div><Collection title="Generated assets" items={item.generatedAssets} render={(asset) => `${asset.kind} · ${asset.assetId} · ${asset.provider || 'provider n/a'} / ${asset.model || 'model n/a'}${asset.durationMs ? ` · ${asset.durationMs / 1000}s` : ''}`} /><details><summary>Validation & provenance</summary><pre>{JSON.stringify({ checks: item.reviewPayload?.technicalValidation, provenance: item.provenance, assets: item.generatedAssets }, null, 2)}</pre></details><div className="actions"><button className="approve" disabled={busy === item.id} onClick={() => decide(item, 'approve')}>APPROVE</button><button className="reject" disabled={busy === item.id} onClick={() => decide(item, 'reject')}>REJECT</button><button className="regenerate" disabled={busy === item.id || item.commandAvailable === false} title={item.commandAvailable === false ? 'Regeneration is available for V2.7 operator productions only' : 'Create a new immutable production'} onClick={() => regenerate(item)}>REGENERATE</button></div></div></article>)}</div> : <Empty text="No validated masters are awaiting human review." />}</State></Page>;
}

export function Providers() {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => Promise.all([api('/api/providers'), api('/api/brands')]).then(([providers, brands]) => ({ providers, brands })), [revision]);
  const [form, setForm] = useState({ brandId: '', provider: 'fal', modelId: '', displayName: '', preset: 'VIDEO_STANDARD' });
  const [message, setMessage] = useState(null);
  async function addModel(event) {
    event.preventDefault(); setMessage(null);
    try { await api('/api/provider-models', { method: 'POST', body: JSON.stringify(form) }); setMessage('Model registered as EXPERIMENTAL. Explicit enablement is required before paid use.'); setRevision((value) => value + 1); }
    catch (error) { setMessage(error.message); }
  }
  return <Page title="Providers / Models" eyebrow="CATALOG · NO GENERATION PROBES"><State state={state}>{({ providers, brands }) => <>
    <Section title="Provider catalog"><div className="provider-grid">{providers.map((item, index) => <article className="provider" key={item.id || `${item.capability}-${index}`}><span className="eyebrow">{item.type || item.mode || item.capability}</span><h2>{item.displayName || item.provider}</h2><div><Badge value={item.availability} /> <Badge value={item.credentialStatus || (item.configured ? 'CONFIGURED' : 'NOT_CONFIGURED')} /></div>{item.models ? <><small>{item.modelCount} registered models</small><p>{item.capabilities.join(' · ') || 'No capabilities'}</p><details><summary>Models</summary>{item.models.map((model) => <p key={model.modelId}><strong>{model.displayName}</strong><br/><code>{model.vendor} / {model.modelId}</code><br/>{Object.keys(model.profiles || {}).join(' · ')} {model.experimental ? <Badge value="EXPERIMENTAL" /> : null}</p>)}</details></> : <code>{item.model || 'No configured model'}</code>}</article>)}</div></Section>
    <Section title="Add compatible aggregator model"><form className="form-grid" onSubmit={addModel}>
      <label>Brand workspace<select aria-label="Model workspace brand" required value={form.brandId} onChange={(event) => setForm({ ...form, brandId: event.target.value })}><option value="">Choose brand scope</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
      <label>Provider<select aria-label="Model provider" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="fal">fal.ai</option><option value="replicate">Replicate</option></select></label>
      <Field label="Model ID" name="modelId" value={form.modelId} change={(name, value) => setForm({ ...form, [name]: value })} required />
      <label>Preset<select aria-label="Model preset" value={form.preset} onChange={(event) => setForm({ ...form, preset: event.target.value })}><option>VIDEO_STANDARD</option><option>VIDEO_T2V_I2V</option></select></label>
      <Field label="Display name" name="displayName" value={form.displayName} change={(name, value) => setForm({ ...form, [name]: value })} />
      <button className="primary" type="submit">ADD MODEL</button>{message ? <div className="notice">{message}</div> : null}
    </form></Section>
  </>}</State></Page>;
}

function Field({ label, name, value, change, required: isRequired = false }) { return <label>{label}<input aria-label={label} name={name} value={value} required={isRequired} onChange={(event) => change(name, event.target.value)} /></label>; }
function TextField({ label, name, value, change, required: isRequired = false }) { return <label className="wide">{label}<textarea aria-label={label} name={name} value={value} required={isRequired} rows="3" onChange={(event) => change(name, event.target.value)} /></label>; }
function Page({ title, eyebrow, children }) { return <main><header className="page-header"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></header>{children}</main>; }
function Section({ title, children }) { return <section className="panel"><h2 className="panel-title">{title}</h2>{children}</section>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function KeyValue({ label, value }) { return <div className="key-value"><span>{label}</span><p>{value || 'Not recorded'}</p></div>; }
function Collection({ title, items, render }) { return <div className="collection"><h4>{title}</h4>{items?.length ? items.map((item, index) => <p key={item.id || item.assetId || `${title}-${index}`}>{render(item)}</p>) : <small>Not recorded</small>}</div>; }
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }

export default function App() {
  const initial = decodeURIComponent(window.location.hash.slice(1)) || 'Overview'; const [page, setPage] = useState(NAV.includes(initial) ? initial : 'Overview'); const [selectedProduction, setSelectedProduction] = useState(null);
  function navigate(next, production = null) { window.location.hash = encodeURIComponent(next); setSelectedProduction(production); setPage(next); }
  const pages = useMemo(() => ({ Overview: <Overview navigate={navigate} />, 'New Production': <NewProduction onCreated={(production) => navigate('Productions', production)} />, Productions: <Productions initialProduction={selectedProduction} />, 'Review Queue': <ReviewQueue />, Brands: <Brands />, 'Providers / Renderers': <Providers /> }), [page, selectedProduction]);
  return <div className="shell"><aside><div className="brand-mark"><span>CF</span><div><strong>Content Factory</strong><small>V2.7 OPERATOR</small></div></div><nav>{NAV.map((item) => <button aria-label={item === 'Providers / Renderers' ? 'Providers' : item} className={page === item ? 'active' : ''} onClick={() => navigate(item)} key={item}>{item}</button>)}</nav><div className="local-only"><span className="pulse" />LOCAL OPERATOR</div></aside>{pages[page]}</div>;
}
