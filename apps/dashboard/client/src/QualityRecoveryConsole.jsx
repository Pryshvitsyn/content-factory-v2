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
      const semantic = plan.semanticEvidence === 'REUSED' ? 'REUSED · 0 calls' : `${plan.semanticEvaluations || 0} external call(s)`;
      const approved = window.confirm(`Re-evaluate existing immutable source?\n\nSOURCE\n${plan.assetId} · ${plan.existingMedia}\n\nVIDEO REGENERATION\n0\n\nSEMANTIC\n${semantic}\n\nTOTAL EXTERNAL CALLS\n${plan.expectedExternalCalls || 0}\n\nEVIDENCE\n${plan.evidenceVersionFrom || 'previous'} → ${plan.evidenceVersionTo}\n\nNo video provider call will be made by this recovery action.`);
      if (!approved) { setMessage('Quality recovery cancelled. No external call was made.'); return; }
      const result = await api(path, { method: 'POST', body: JSON.stringify({ brandId: item.brandId, confirmation: true }) });
      setMessage(result.accepted
        ? `Existing ${result.assetId} preserved and re-evaluated. Disposition: ${result.disposition}. Video regeneration: 0. Continue the same execution separately when ready.`
        : `Recovery reused existing result. Disposition: ${result.disposition || 'recorded'}.`);
      await load();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(null); }
  }

  if (!visible || !items.length) return null;
  return <aside className="quality-recovery-console" aria-label="Quality evidence recovery">
    <div className="quality-recovery-console__head"><div><span>V2.10.1 · SAFE RECOVERY</span><strong>Paid asset protection</strong></div><span className="quality-recovery-console__zero">VIDEO REGEN · 0</span></div>
    <p>Re-evaluate persisted media before paying to regenerate it. Recovery never starts a video provider call.</p>
    {message ? <div className="quality-recovery-console__message">{message}</div> : null}
    <div className="quality-recovery-console__list">{items.map((item) => {
      const recovery = item.qualityRecovery || {};
      return <article key={item.id} className="quality-recovery-console__item">
        <div><small>{item.brandName}</small><strong>{item.title || item.name}</strong><code>{item.id.slice(0, 8)}</code></div>
        <dl><div><dt>Source</dt><dd>{recovery.assetId || recovery.evidence?.artifactId || 'immutable media'}</dd></div><div><dt>Media</dt><dd>{recovery.existingMedia || 'REUSED'}</dd></div><div><dt>Semantic</dt><dd>{recovery.semanticEvidence || (recovery.recovered ? 'RECORDED' : '—')}</dd></div><div><dt>Disposition</dt><dd>{recovery.disposition || recoveryLabel(item)}</dd></div></dl>
        {recovery.eligible ? <button disabled={busy === item.id} onClick={() => recover(item)}>RE-EVALUATE EXISTING ASSET · 0 VIDEO CALLS</button>
          : <div className="quality-recovery-console__recovered">✓ Existing source re-evaluated · use CONTINUE SAME EXECUTION in production detail</div>}
      </article>;
    })}</div>
  </aside>;
}
