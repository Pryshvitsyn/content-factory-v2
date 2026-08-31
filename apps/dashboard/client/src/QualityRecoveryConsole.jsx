import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './QualityRecoveryConsole.css';

function recoveryLabel(item) {
  if (item?.qualityRecovery?.recovered) return 'RECOVERED';
  if (item?.qualityRecovery?.eligible) return 'RECOVERY AVAILABLE';
  return item?.qualityRecovery?.status || 'NOT AVAILABLE';
}

function regenerationCopy(plan, shotPlan) {
  const continuity = plan.recoveryKind === 'SOURCE_CONTINUITY';
  const creative = plan.recoveryKind === 'SOURCE_CREATIVE';
  if (continuity) return `CROSS-SHOT CONTINUITY FAILED\n${(plan.hardFailureCodes || []).join(', ') || 'continuity drift'}\n\nRecovery:\nREGENERATE FAILED SHOT\n\nEstimated new video generations: ${shotPlan.expectedVideoGenerations}\nExisting good assets reused: yes\nRejected version preserved: yes\nReplacement source QA: required\nCross-shot continuity: required before downstream shot acceptance\nAutomatic continuity retry loop: disabled\nEvery replacement requires operator confirmation\n\nExternal calls (preflight maximum): ${shotPlan.expectedExternalCalls}\nCost: ${shotPlan.costStatus || 'UNKNOWN'}`;
  if (creative) return `CREATIVE PLAN MISMATCH\n${(plan.hardFailureCodes || []).join(', ') || 'CREATIVE_PLAN_MISMATCH'}\n\nDurable mismatch reason:\n${plan.failureReason || 'No evaluator reason was recorded.'}\n\nOperator corrective instruction:\n${shotPlan.operatorCorrectiveInstruction || 'None supplied; recovery uses the approved plan and durable mismatch evidence.'}\n\nRecovery kind:\nSOURCE_CREATIVE\n\nAction:\nREGENERATE FAILED SHOT\n\nSource: ${plan.assetId}\nExpected new video generations: 1\nExpected semantic evaluations: 1\nMaximum replacement external calls: ${shotPlan.maximumExternalCalls || shotPlan.expectedExternalCalls}\nExisting failed artifact: PRESERVED IMMUTABLY\nExisting good assets: REUSED\nSame production: YES\nAuto-publish: false\nHuman approval required: true\n\nCost: ${shotPlan.costStatus || 'UNKNOWN'}`;
  return `SOURCE GEOMETRY FAILED\n${plan.actualWidth || '?'}×${plan.actualHeight || '?'}\nExpected ${plan.expectedAspectRatio}\n\nRecovery:\nREGENERATE FAILED SHOT\n\nEstimated new video generations: ${shotPlan.expectedVideoGenerations}\nExisting good assets reused: yes\nExisting semantic evidence reused: no (replacement is revalidated)\nMaximum automatic geometry attempts: 1\nRequires paid provider confirmation: yes\n\nExternal calls: ${shotPlan.expectedExternalCalls}\nCost: ${shotPlan.costStatus || 'UNKNOWN'}`;
}

export function QualityRecoveryConsole() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [creativeInstructions, setCreativeInstructions] = useState({});
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
        const continuity = plan.recoveryKind === 'SOURCE_CONTINUITY';
        const creative = plan.recoveryKind === 'SOURCE_CREATIVE';
        const instruction = continuity
          ? 'V2.10.3 cross-shot continuity recovery; preserve approved creative, accepted predecessors, character identity, wardrobe, environment, realism and acting language.'
          : creative
            ? creativeInstructions[item.id]?.trim() || null
            : 'V2.10.2 deterministic source-geometry recovery; preserve approved creative and established continuity.';
        const recoveryReason = continuity ? null : creative ? 'SOURCE_CREATIVE' : 'SOURCE_GEOMETRY';
        const shotPath = `/api/productions/${item.id}/shots/${encodeURIComponent(plan.shotId)}`;
        const request = { brandId: item.brandId, requestId, instruction };
        if (recoveryReason) request.recoveryReason = recoveryReason;
        const shotPlan = await api(`${shotPath}/preflight`, { method: 'POST', body: JSON.stringify(request) });
        const approved = window.confirm(regenerationCopy(plan, shotPlan));
        if (!approved) { setMessage(`${continuity ? 'Continuity' : creative ? 'Creative' : 'Geometry'} recovery cancelled before any provider call.`); return; }
        const body = { brandId: item.brandId, requestId, instruction,
          preflightId: shotPlan.preflightId, confirmation: true };
        if (recoveryReason) body.recoveryReason = recoveryReason;
        const result = await api(`${shotPath}/regenerate`, { method: 'POST', body: JSON.stringify(body) });
        setMessage(continuity
          ? `Continuity-rejected ${plan.assetId} remains immutable. Replacement ${result.replacementAssetId || result.regenerationId} was explicitly requested; downstream shots remain gated until continuity acceptance.`
          : creative
            ? `Creative-rejected ${plan.assetId} remains immutable. Replacement ${result.replacementAssetId} was explicitly requested; no downstream work runs before fresh acceptance.`
            : `Failed ${plan.assetId} replacement accepted as ${result.replacementAssetId}. Shot 1 and audio remain immutable and reused.`);
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
    <div className="quality-recovery-console__head"><div><span>V2.10.4 · SAFE RECOVERY</span><strong>Source recovery & paid asset protection</strong></div><span className="quality-recovery-console__zero">BOUNDED · EXPLICIT</span></div>
    <p>Evidence-only issues reuse immutable media. Objective geometry, creative-plan mismatch, and cross-shot continuity failures require an explicitly confirmed failed-shot replacement; rejected versions and good assets stay immutable.</p>
    {message ? <div className="quality-recovery-console__message">{message}</div> : null}
    <div className="quality-recovery-console__list">{items.map((item) => {
      const recovery = item.qualityRecovery || {};
      return <article key={item.id} className="quality-recovery-console__item">
        <div><small>{item.brandName}</small><strong>{item.title || item.name}</strong><code>{item.id.slice(0, 8)}</code></div>
        <dl><div><dt>Source</dt><dd>{recovery.assetId || recovery.evidence?.artifactId || 'immutable media'}</dd></div><div><dt>Media</dt><dd>{recovery.existingMedia || 'REUSED'}</dd></div><div><dt>Recovery</dt><dd>{recovery.recoveryKind || 'EVIDENCE_ONLY'}</dd></div><div><dt>Disposition</dt><dd>{recovery.disposition || recoveryLabel(item)}</dd></div></dl>
        {recovery.hardFailureCodes?.length ? <small>{recovery.hardFailureCodes.join(' · ')}</small> : null}
        {recovery.eligible && recovery.recoveryKind === 'SOURCE_CREATIVE' ? <div className="quality-recovery-console__creative-context">
          <strong>Durable mismatch reason</strong>
          <p>{recovery.failureReason || 'No evaluator reason was recorded.'}</p>
          <label htmlFor={`creative-recovery-${item.id}`}>Operator corrective instruction <small>optional · editable before paid confirmation</small></label>
          <textarea id={`creative-recovery-${item.id}`} rows={5} maxLength={1200}
            placeholder="Add shot-specific corrective constraints. Nothing brand- or subject-specific is injected automatically."
            value={creativeInstructions[item.id] || ''}
            onChange={(event) => setCreativeInstructions((current) => ({ ...current, [item.id]: event.target.value }))} />
        </div> : null}
        {recovery.eligible ? <button disabled={busy === item.id} onClick={() => recover(item)}>{recovery.action === 'REGENERATE_SHOT' ? 'REGENERATE FAILED SHOT · 1 VIDEO' : 'RE-EVALUATE EXISTING ASSET · 0 VIDEO CALLS'}</button>
          : recovery.recovered ? <><div className="quality-recovery-console__recovered">{['SOURCE_GEOMETRY','SOURCE_CREATIVE'].includes(recovery.recoveryKind)
            ? '✓ Failed source replaced immutably · exact production identity preserved'
            : '✓ Existing source re-evaluated · exact V2.10 identity preserved'}</div><button disabled={busy === `continue:${item.id}`} onClick={() => continueSameExecution(item)}>CONTINUE SAME EXECUTION</button></>
            : <div className="quality-recovery-console__recovered">Recovery is not currently available.</div>}
      </article>;
    })}</div>
  </aside>;
}
