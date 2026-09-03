import React from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import './KeyframeValidationConsole.css';

function selectedValue(label) {
  return document.querySelector(`select[aria-label="${label}"]`)?.value || '';
}

function keyframePanel() {
  return Array.from(document.querySelectorAll('section.panel')).find((panel) =>
    Array.from(panel.querySelectorAll('.panel-title')).some((title) => title.textContent?.trim() === 'LOCKED OPENING KEYFRAME')) || null;
}

function statusCopy(status) {
  if (status === 'PASS') return 'PASS · HUMAN APPROVAL AVAILABLE';
  if (status === 'WARN') return 'WARN · APPROVAL BLOCKED · PASS REQUIRED';
  return 'FAIL · APPROVAL BLOCKED · PASS REQUIRED';
}

export function KeyframeValidationConsole() {
  const [state, setState] = React.useState(null);
  const [target, setTarget] = React.useState(null);
  const keyRef = React.useRef('');
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || inFlight.current) return;
      const draftId = selectedValue('DRAFT');
      const brandId = selectedValue('BRAND');
      const panel = keyframePanel();
      if (panel !== target) setTarget(panel);
      if (!draftId || !brandId || !window.location.hash.includes('Creative%20Production')) {
        keyRef.current = '';
        setState(null);
        return;
      }
      const key = `${brandId}:${draftId}`;
      inFlight.current = true;
      try {
        const value = await api(`/api/v2.10/creative-drafts/${encodeURIComponent(draftId)}/locked-keyframe/state?brandId=${encodeURIComponent(brandId)}`);
        if (!cancelled) {
          keyRef.current = key;
          setState(value);
        }
      } catch {
        if (!cancelled && keyRef.current !== key) setState(null);
      } finally {
        inFlight.current = false;
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [target]);

  const result = state?.keyframeResult;
  if (!result?.validation) return null;
  const validation = result.validation;
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  const content = <div className="keyframe-validation-console" data-status={validation.status}>
    <div className="keyframe-validation-console__head">
      <div>
        <span>SEMANTIC KEYFRAME QA · PERSISTED EVIDENCE</span>
        <strong>{statusCopy(validation.status)}</strong>
      </div>
      <small>READ ONLY · 0 NEW CALLS</small>
    </div>
    {validation.status !== 'PASS' ? <p className="keyframe-validation-console__block">
      Video remains blocked. Human approval cannot override semantic FAIL/WARN; a PASS validation is required first.
    </p> : null}
    <div className="keyframe-validation-console__checks">
      {checks.length ? checks.map((check, index) => <article key={`${check.code}-${index}`} data-status={check.status}>
        <strong>{check.status} · {check.code}</strong>
        <p>{check.reason}</p>
      </article>) : <p>No individual semantic checks were persisted for this validation.</p>}
    </div>
    <div className="keyframe-validation-console__meta">
      <span>Evaluator {validation.metadata?.provider || 'unknown'} / {validation.metadata?.model || 'unknown'}</span>
      <span>Recorded semantic calls {Number(validation.metadata?.externalCalls || 0)}</span>
      {state.attempt?.id ? <span>Attempt {String(state.attempt.id).slice(0, 8)} · {state.attempt.status}</span> : null}
    </div>
  </div>;

  return target ? createPortal(content, target) : <aside className="keyframe-validation-console--fallback">{content}</aside>;
}
