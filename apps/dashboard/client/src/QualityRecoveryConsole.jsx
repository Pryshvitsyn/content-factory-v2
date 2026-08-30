import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './QualityRecoveryConsole.css';

function recoveryLabel(item) {
  if (item?.qualityRecovery?.recovered) return 'RECOVERED';
  if (item?.qualityRecovery?.eligible) return 'RECOVERY AVAILABLE';
  return item?.qualityRecovery?.status || 'NOT AVAILABLE';
}

export function QualityRecoveryConsole() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [visible, setVisible] = useState(window.location.hash.includes('Productions'));

  async function load() {
    if (!window.location.hash.includes('Productions')) { setItems([]); return; }
    try {
      const failed = await api('/api/productions?failed=true');
      const detailed = await Promise.all((failed || []).slice(0, 12).map(async (item) => {
        try { return await api(`/api/productions/${item.id}?brandId=${item.brandId}`); }
        catch { return null; }
      }));
      setItems(detailed.filter((item) => item?.qualityRecovery?.eligible || item?.qualityRecovery?.recovered));
    } catch { setItems([]); }
  }

  useEffect(() => {
    const hash = () => { setVisible(window.location.hash.includes('Productions')); load(); };
    window.addEventListener('hashchange', hash);
    load();
    const timer = setInterval(load, 5000);
    return () => { window.removeEventListener('hashchange', hash); clearInterval(timer); };
  }, []);

  const eligible = useMemo(() => items.some((item) => item.qualityRecovery?.eligible), [items]);
  useEffect(() => {
    document.body.classList.toggle('quality-recovery-available', visible && eligible);
    return () => document.body.classList.remove('quality-recovery-available');
  }, [visible, eligible]);

  async function recover(item) {
    setBusy(item.id); setMessage(null);
    try {
      const path = `/api/productions/${item.id}/quality-recovery`;
      const plan = await api(`${path}/preflight`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId }) });
      if (plan.action === 'REGENERATE_SHOT') {
        const requestId = globalThis.crypto?.randomUUID?.() || '11111111-1111-4111-8111-111111111111';
        const instruction = 'V2.10.2 deterministic source-geometry recovery; preserve approved creative and established continuity.';
        const shotPath = `/api/productions/${item.id}/shots/${encodeURIComponent(plan.shotId)}`;
        const shotPlan = await api(`${shotPath}/preflight`, { method: 'POST', body: JSON.stringify({
          brandId: item.brandId, requestId, instruction, recoveryReason: 'SOURCE_GEOMETRY' }) });
        const approved = window.confirm(`SOURCE GEOMETRY FAILED\n${plan.actualWidth || '?'}×${plan.actualHeight || '?'}\nExpected ${plan.expectedAspectRatio}\n\nRecovery:\nREGENERATE FAILED SHOT\n\nEstimated new video generations: ${shotPlan.expectedVideoGenerations}\nExisting good assets reused: yes\nExisting semantic evidence reused: no (replacement is revalidated)\nMaximum automatic geometry attempts: 1\nRequires paid provider confirmation: yes\n\nExternal calls: ${shotPlan.expectedExternalCalls}\nCost: ${shotPlan.costStatus || 'UNKNOWN'}`);
        if (!approved) { setMessage('Geometry recovery cancelled before any provider call.'); return; }
        const result = await api(`${shotPath}/regenerate`, { method: 'POST', body: JSON.stringify({
          brandId: item.brandId, requestId, instruction, recoveryReason: 'SOURCE_GEOMETRY',
          preflightId: shotPlan.preflightId, confirmation: true }) });
        setMessage(`Failed ${plan.assetId} replacement accepted as ${result.replacementAssetId}. Shot 1 and audio remain immutable and reused.`);
        await load(); return;
      }
      const semantic = plan.semanticEvidence === 'REUSED' ? 'REUSED · 0 calls' : `${plan.semanticEvaluations || 0} external call(s)`;
      const approved = window.confirm(`Re-evaluate existing immutable source?\n\nSOURCE\n${plan.assetId} · ${plan.existingMedia}\n\nVIDEO REGENERATION\n0\n\nSEMANTIC\n${semantic}\n\nTOTAL EXTERNAL CALLS\n${plan.expectedExternalCalls || 0}\n\nEVIDENCE\n${plan.evidenceVersionFrom || 'previous'} → ${plan.evidenceVersionTo}\n\nNo video provider call will be made by this recovery action.`);
      if (!approved) { setMessage('Quality recovery cancelled. No external call was made.'); return; }
      const result = await api(path, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, confirmation: true }) });
      setMessage(result.accepted
        ? `Existing ${result.assetId} preserved and re-evaluated. Disposition: ${result.disposition}. Video regeneration: 0.`
        : `Recovery reused existing result. Disposition: ${result.disposition || 'recorded'}.`);
      await load();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(null); }
  }

  async function continueSameExecution(item) {
    setBusy(`continue:${item.id}`); setMessage(null);
    try {
      const path = `/api/productions/${item.id}/quality-recovery/continue`;
      const plan = await api(`${path}/preflight`, { method: 'POST', body: JSON.stringify({ brandId: item.brandId }) });
      const approved = window.confirm(`Continue this exact V2.10 execution?\n\nCANONICAL IDENTITY\nVERIFIED\n\nPRESERVED SOURCE MEDIA\n${plan.existingSourceMedia}\n\nREMAINING VIDEO GENERATIONS\n${plan.remainingVideoGenerations}\n${(plan.remainingVideoAssetIds || []).join(', ') || 'none'}\n\nREMAINING SPEECH GENERATIONS\n${plan.remainingSpeechGenerations}\n\nVIDEO ROUTE\n${plan.provider || 'provider'} · ${plan.model || 'model'} · ${plan.profile || 'profile'} · ${plan.resolution || 'resolution'}\n\nEVALUATOR CALLS PLANNED\n${plan.evaluatorCallsPlanned}\n\nCOST\n${plan.costStatus || 'UNKNOWN'}\n\nExisting paid media will be reused. No automatic regeneration of an existing video asset is allowed. Human approval remains required.`);
      if (!approved) { setMessage('Same-execution continuation cancelled before any new provider execution.'); return; }
      const result = await api(path, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, confirmation: true }) });
      setMessage(result.accepted
        ? 'Exact V2.10 continuation accepted. Existing paid media is preserved; watch the production state and do not click again.'
        : 'Continuation was not accepted. No new execution was started.');
      await load();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(null); }
  }

  if (!visible || !items.length) return null;
  return <aside className="quality-recovery-console" aria-label="Quality evidence recovery">
    <div className="quality-recovery-console__head"><div><span>V2.10.2 · SAFE RECOVERY</span><strong>Source recovery & paid asset protection</strong></div><span className="quality-recovery-console__zero">BOUNDED · EXPLICIT</span></div>
    <p>Evidence-only issues reuse immutable media. Objective geometry failures offer one confirmed failed-shot replacement and preserve good assets.</p>
    {message ? <div className="quality-recovery-console__message">{message}</div> : null}
    <div className="quality-recovery-console__list">{items.map((item) => {
      const recovery = item.qualityRecovery || {};
      return <article key={item.id} className="quality-recovery-console__item">
        <div><small>{item.brandName}</small><strong>{item.title || item.name}</strong><code>{item.id.slice(0, 8)}</code></div>
        <dl><div><dt>Source</dt><dd>{recovery.assetId || recovery.evidence?.artifactId || 'immutable media'}</dd></div><div><dt>Media</dt><dd>{recovery.existingMedia || 'REUSED'}</dd></div><div><dt>Semantic</dt><dd>{recovery.semanticEvidence || (recovery.recovered ? 'RECORDED' : '—')}</dd></div><div><dt>Disposition</dt><dd>{recovery.disposition || recoveryLabel(item)}</dd></div></dl>
        {recovery.eligible ? <button disabled={busy === item.id} onClick={() => recover(item)}>{recovery.action === 'REGENERATE_SHOT' ? 'REGENERATE FAILED SHOT · 1 VIDEO' : 'RE-EVALUATE EXISTING ASSET · 0 VIDEO CALLS'}</button>
          : recovery.recovered ? <><div className="quality-recovery-console__recovered">{recovery.recoveryKind === 'SOURCE_GEOMETRY'
            ? '✓ Failed source replaced immutably · exact production identity preserved'
            : '✓ Existing source re-evaluated · exact V2.10 identity preserved'}</div><button disabled={busy === `continue:${item.id}`} onClick={() => continueSameExecution(item)}>CONTINUE SAME EXECUTION</button></>
            : <div className="quality-recovery-console__recovered">Recovery is not currently available.</div>}
      </article>;
    })}</div>
  </aside>;
}
