import React, { useEffect, useState } from 'react';
import { api, artifactUrl, decideReview } from './api';

const NAV = ['Overview', 'Brands', 'Productions', 'Review Queue', 'Providers'];

function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: null });
    loader().then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => live && setState({ loading: false, data: null, error: error.message }));
    return () => { live = false; };
  }, dependencies);
  return state;
}

function State({ state, children }) {
  if (state.loading) return <div className="empty">Loading persisted state…</div>;
  if (state.error) return <div className="error-panel">{state.error}</div>;
  return children(state.data);
}

export function Badge({ value = 'NOT_STARTED' }) {
  return <span className={`badge badge-${String(value).toLowerCase()}`}>{value}</span>;
}

function Overview() {
  const state = useLoad(() => Promise.all([api('/api/overview'), api('/api/providers')]).then(([overview, providers]) => ({ overview, providers })));
  return <Page title="Overview" eyebrow="LIVE CONTROL PLANE"><State state={state}>{({ overview, providers }) => <>
    <div className="metric-grid">
      {[
        ['Brands', overview.totalBrands], ['Active productions', overview.activeProductions], ['Queued jobs', overview.queuedJobs],
        ['Running jobs', overview.runningJobs], ['Failed jobs', overview.failedJobs], ['Awaiting review', overview.awaitingReview],
        ['Completed · 7d', overview.recentlyCompleted], ['Providers configured', providers.filter((item) => item.configured).length],
      ].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    <Section title="Recent activity"><div className="activity-list">
      {overview.recentActivity.length ? overview.recentActivity.map((item) => <div className="activity" key={`${item.type}-${item.id}`}>
        <span className="activity-type">{item.type}</span><span>{item.label}</span><Badge value={item.status} />
        <time>{formatDate(item.occurredAt)}</time>
      </div>) : <Empty text="No persisted activity." />}
    </div></Section>
  </>}</State></Page>;
}

function Brands() {
  const [selected, setSelected] = useState(null);
  const list = useLoad(() => api('/api/brands'));
  const detail = useLoad(() => selected ? api(`/api/brands/${selected}`) : Promise.resolve(null), [selected]);
  return <Page title="Brands" eyebrow="STRICTLY SCOPED">
    <div className="split"><Section title="Brand portfolio"><State state={list}>{(brands) => brands.length ? brands.map((brand) =>
      <button className={`row-button ${selected === brand.id ? 'selected' : ''}`} key={brand.id} onClick={() => setSelected(brand.id)}>
        <span><strong>{brand.name}</strong><small>{brand.id}</small></span><Badge value={brand.status} />
      </button>) : <Empty text="No brands in the configured database." />}</State></Section>
    <Section title="Brand brain"><State state={detail}>{(brand) => brand ? <BrandDetail brand={brand} /> : <Empty text="Select a brand." />}</State></Section></div>
  </Page>;
}

function BrandDetail({ brand }) {
  const groups = brand.knowledge.reduce((result, item) => ({ ...result, [item.knowledgeType]: [...(result[item.knowledgeType] || []), item] }), {});
  return <div className="detail-stack">
    <div className="detail-head"><div><h3>{brand.name}</h3><code>{brand.id}</code></div><Badge value={brand.status} /></div>
    <KeyValue label="Mission" value={brand.mission} /><KeyValue label="Positioning" value={brand.positioning} />
    <Collection title="Products" items={brand.products} render={(item) => `${item.name} · ${item.valueProposition || item.productType}`} />
    <Collection title="Audiences" items={brand.audiences} render={(item) => `${item.name} · ${item.problemStatement || 'No problem statement'}`} />
    <Collection title="Offers" items={brand.offers} render={(item) => `${item.name} · ${item.cta || 'No CTA'}`} />
    <Collection title="Campaigns" items={brand.campaigns} render={(item) => `${item.name} · ${item.objective}`} />
    {Object.entries(groups).map(([name, items]) => <Collection key={name} title={name.replaceAll('_', ' ')} items={items} render={(item) => JSON.stringify(item.content)} />)}
    <Collection title="Reusable assets" items={brand.assets} render={(item) => `${item.kind} · ${item.assetId} · v${item.version}`} />
  </div>;
}

function Productions() {
  const brands = useLoad(() => api('/api/brands'));
  const [filters, setFilters] = useState({ brandId: '', status: '' });
  const [selected, setSelected] = useState(null);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  const list = useLoad(() => api(`/api/productions?${query}`), [filters.brandId, filters.status]);
  return <Page title="Productions" eyebrow="PERSISTED EXECUTION TRUTH">
    <div className="filters"><State state={brands}>{(items) => <select aria-label="Brand filter" value={filters.brandId} onChange={(event) => setFilters({ ...filters, brandId: event.target.value })}>
      <option value="">All brands</option>{items.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select>}</State>
      <select aria-label="Status filter" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">All states</option>{['DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED'].map((status) => <option key={status}>{status}</option>)}</select>
    </div>
    {selected ? <ProductionDetail production={selected} onBack={() => setSelected(null)} /> : <Section title="Newest first"><State state={list}>{(items) => items.length ?
      <div className="table-wrap"><table><thead><tr><th>Production</th><th>Brand</th><th>Objective</th><th>Stage</th><th>Status</th><th>Review</th><th>Updated</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id} onClick={() => setSelected(item)}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{item.brandName || 'Unscoped legacy'}</td><td>{item.objective || '—'}</td><td>{item.currentStage || '—'}</td><td><Badge value={item.status} /></td><td>{item.reviewState ? <Badge value={item.reviewState} /> : '—'}</td><td>{formatDate(item.updatedAt)}</td></tr>)}</tbody></table></div> : <Empty text="No productions match the filters." />}</State></Section>}
  </Page>;
}

function ProductionDetail({ production, onBack }) {
  const scope = production.brandId ? `?brandId=${production.brandId}` : '';
  const state = useLoad(() => Promise.all([
    api(`/api/productions/${production.id}${scope}`), api(`/api/productions/${production.id}/stages${scope}`), api(`/api/productions/${production.id}/artifacts${scope}`),
  ]).then(([item, stages, artifacts]) => ({ item, stages, artifacts })), [production.id]);
  return <State state={state}>{({ item, stages, artifacts }) => <>
    <button className="back" onClick={onBack}>← All productions</button>
    <div className="detail-head"><div><h2>{item.name}</h2><code>{item.id}</code></div><Badge value={item.status} /></div>
    <Section title="Canonical pipeline"><div className="pipeline">{stages.map((stage) => <article className="stage" key={stage.stage}>
      <span>{String(stage.sequence).padStart(2, '0')}</span><strong>{stage.stage}</strong><Badge value={stage.status || 'NOT_STARTED'} />
      <small>Attempt {stage.attempt || '—'} · {stage.provider || 'provider n/a'} / {stage.model || 'model n/a'}</small>
      {Object.keys(stage.error || {}).length ? <pre>{JSON.stringify(stage.error, null, 2)}</pre> : null}
      {stage.outputArtifacts?.length ? <code>{stage.outputArtifacts.join('\n')}</code> : null}
    </article>)}</div></Section>
    <Section title="Artifacts"><div className="artifact-grid">{artifacts.length ? artifacts.map((artifact) => <ArtifactCard artifact={artifact} key={`${artifact.sourceId}-${artifact.artifactId}`} />) : <Empty text="No safely scoped artifacts." />}</div></Section>
  </>}</State>;
}

function ArtifactCard({ artifact }) {
  const url = artifactUrl(artifact);
  const media = artifact.contentType?.startsWith('video/') ? <video controls preload="metadata" src={url} />
    : artifact.contentType?.startsWith('image/') ? <img src={url} alt={artifact.artifactId} />
      : artifact.contentType?.startsWith('audio/') ? <audio controls preload="metadata" src={url} /> : null;
  return <article className="artifact-card">{media}<strong>{artifact.type}</strong><code>{artifact.artifactId}</code>
    <small>v{artifact.version} · {formatDate(artifact.createdAt)}</small><Badge value={artifact.reviewState || artifact.validationStatus} />
    <small>{artifact.provenance?.provider || 'provider n/a'} / {artifact.provenance?.model || 'model n/a'}</small></article>;
}

export function ReviewQueue() {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => api('/api/reviews'), [revision]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function decide(item, decision) {
    const reason = decision === 'reject' ? window.prompt('Rejection reason') : null;
    if (decision === 'reject' && !reason) return;
    setBusy(item.id); setError(null);
    try { await decideReview(item, decision, reason); setRevision((value) => value + 1); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  }
  return <Page title="Review Queue" eyebrow="HUMAN DECISION BOUNDARY">
    <p className="page-note">Approval applies only to the exact immutable master shown here. It never publishes.</p>
    {error ? <div className="error-panel">{error}</div> : null}
    <State state={state}>{(items) => items.length ? <div className="review-grid">{items.map((item) => <article className="review-card" key={item.id}>
      <video controls preload="metadata" src={artifactUrl({ ...item, sourceId: item.id, version: item.artifactVersion })} />
      <div className="review-body"><div className="detail-head"><div><span className="eyebrow">{item.brandName}</span><h2>{item.productionName}</h2></div><Badge value="AWAITING_HUMAN_APPROVAL" /></div>
        <code>{item.artifactId} · v{item.artifactVersion}</code>
        <div className="review-copy"><KeyValue label="Hook" value={item.reviewPayload?.hook} /><KeyValue label="CTA" value={item.reviewPayload?.cta} />
          <KeyValue label="Duration" value={item.reviewPayload?.durationMs ? `${item.reviewPayload.durationMs / 1000}s` : null} />
          <KeyValue label="Quality" value={`${item.validationEvidence?.status || item.validationStatus} · ${item.validationEvidence?.score ?? 'n/a'}`} /></div>
        <details><summary>Script</summary><pre>{JSON.stringify(item.reviewPayload?.script, null, 2)}</pre></details>
        <details><summary>Validation & provenance</summary><pre>{JSON.stringify({ checks: item.reviewPayload?.technicalValidation, provenance: item.provenance, assets: item.generatedAssets }, null, 2)}</pre></details>
        <div className="actions"><button className="approve" disabled={busy === item.id} onClick={() => decide(item, 'approve')}>APPROVE</button>
          <button className="reject" disabled={busy === item.id} onClick={() => decide(item, 'reject')}>REJECT</button></div>
      </div></article>)}</div> : <Empty text="No validated masters are awaiting human review." />}</State>
  </Page>;
}

function Providers() {
  const state = useLoad(() => api('/api/providers'));
  return <Page title="Providers" eyebrow="OBSERVATIONAL · NO PAID PROBES"><Section title="Capability routing"><State state={state}>{(items) =>
    <div className="provider-grid">{items.map((item) => <article className="provider" key={`${item.capability}-${item.provider}`}>
      <span className="eyebrow">{item.capability}</span><h2>{item.provider}</h2><code>{item.model || 'No configured model'}</code>
      <div><Badge value={item.availability} /> {item.route ? <span className="route">{item.route}</span> : null}</div>
    </article>)}</div>}</State></Section></Page>;
}

function Page({ title, eyebrow, children }) { return <main><header className="page-header"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></header>{children}</main>; }
function Section({ title, children }) { return <section className="panel"><h2 className="panel-title">{title}</h2>{children}</section>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function KeyValue({ label, value }) { return <div className="key-value"><span>{label}</span><p>{value || 'Not recorded'}</p></div>; }
function Collection({ title, items, render }) { return <div className="collection"><h4>{title}</h4>{items?.length ? items.map((item) => <p key={item.id}>{render(item)}</p>) : <small>Not recorded</small>}</div>; }
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }

export default function App() {
  const initial = decodeURIComponent(window.location.hash.slice(1)) || 'Overview';
  const [page, setPage] = useState(NAV.includes(initial) ? initial : 'Overview');
  const pages = { Overview: <Overview />, Brands: <Brands />, Productions: <Productions />, 'Review Queue': <ReviewQueue />, Providers: <Providers /> };
  function navigate(next) { window.location.hash = encodeURIComponent(next); setPage(next); }
  return <div className="shell"><aside><div className="brand-mark"><span>CF</span><div><strong>Content Factory</strong><small>V2.3 CONTROL</small></div></div>
    <nav>{NAV.map((item) => <button className={page === item ? 'active' : ''} onClick={() => navigate(item)} key={item}>{item}</button>)}</nav>
    <div className="local-only"><span className="pulse" />LOCAL OPERATOR</div></aside>{pages[page]}</div>;
}
