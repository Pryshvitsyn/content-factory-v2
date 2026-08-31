import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './AvatarStudio.css';

const LEVEL_NAMES = ['IDENTITY','PASSPORT','BODY EXPRESSIONS','WARDROBE','VOICE','LOCATIONS','PERFORMANCE','MULTISHOT CONTINUITY'];
const VERTICAL_LABELS = {
  PSYCHOLOGY_WELLBEING: 'Psychology & Wellbeing', CONSTRUCTION_RENOVATION: 'Construction & Renovation',
  LUXURY_LIFESTYLE: 'Luxury Lifestyle', TRAVEL: 'Travel',
};

function Badge({ value }) { return <span className={`avatar-badge avatar-${String(value || '').toLowerCase()}`}>{String(value || 'NOT STARTED').replaceAll('_', ' ')}</span>; }
function ErrorPanel({ error }) { return error ? <div className="error-panel"><strong>{error.code}</strong><p>{error.message}</p></div> : null; }
function Select({ label, value, onChange, children, required = true }) { return <label>{label}<select aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Input({ label, value, onChange, required = true }) { return <label>{label}<input aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }

function LevelLadder({ avatar }) {
  const state = avatar?.levelState || avatar;
  return <div className="avatar-levels">{LEVEL_NAMES.map((name, level) => <article className={level <= (state?.currentLevel ?? 0) ? 'complete' : level === (state?.currentLevel ?? 0) + 1 ? 'next' : ''} key={name}>
    <span>L{level}</span><strong>{name}</strong><small>{level <= (state?.currentLevel ?? 0) ? 'COMPLETE' : level === (state?.currentLevel ?? 0) + 1 ? 'NEXT' : 'LOCKED'}</small>
  </article>)}</div>;
}

function AvatarDetail({ avatar, close }) {
  if (!avatar) return null;
  const state = avatar.levelState || avatar;
  return <section className="avatar-detail"><div className="avatar-detail-head"><div><span className="eyebrow">AVATAR DETAIL</span><h2>{avatar.internalName}</h2></div><button className="secondary" onClick={close}>CLOSE</button></div>
    <div className="avatar-summary"><div><span>CURRENT LEVEL</span><strong>L{state.currentLevel} · {state.currentLevelName || state.levelName}</strong></div><div><span>NEXT LEVEL</span><strong>{state.nextLevel ? `L${state.nextLevel.level} · ${state.nextLevel.name}` : 'MAX FIRST-SLICE LEVEL'}</strong></div><div><span>VERTICAL</span><strong>{VERTICAL_LABELS[avatar.vertical || avatar.verticalCode]}</strong></div><div><span>CONSENT</span><Badge value={avatar.consentApproved || avatar.consent?.status || 'APPROVED'} /></div></div>
    <LevelLadder avatar={avatar} />
    <div className="avatar-requirements"><article><h3>Completed requirements</h3>{(state.completedRequirements || []).map((item) => <code key={item}>{item}</code>)}</article><article><h3>Missing requirements</h3>{(state.missingRequirements || []).length ? state.missingRequirements.map((item) => <code key={item}>{item}</code>) : <small>None</small>}</article><article><h3>Blocking failures</h3>{(state.blockingFailures || []).length ? state.blockingFailures.map((item) => <code key={item}>{item}</code>) : <small>None</small>}</article></div>
    <div className="avatar-pack-grid">{[['Passport candidates',avatar.passports],['Wardrobe packs',avatar.wardrobes],['Voice profiles',avatar.voiceProfiles],['Location packs',avatar.locations],['Performance packs',avatar.performancePacks]].map(([label,items]) => <article key={label}><span>{label}</span><strong>{items?.length || 0}</strong></article>)}</div>
  </section>;
}

function AvatarLibrary({ brands, selectedBrand, setSelectedBrand, revision }) {
  const [items, setItems] = useState([]); const [selected, setSelected] = useState(null); const [error, setError] = useState(null);
  useEffect(() => { if (!selectedBrand) { setItems([]); return; } let live = true;
    api(`/api/avatar-studio/avatars?brandId=${encodeURIComponent(selectedBrand)}`).then((value) => live && setItems(value)).catch((cause) => live && setError(cause));
    return () => { live = false; };
  }, [selectedBrand, revision]);
  async function open(item) { setError(null); try { setSelected(await api(`/api/avatar-studio/avatars/${item.id}?brandId=${encodeURIComponent(selectedBrand)}`)); } catch (cause) { setError(cause); } }
  return <><section className="panel avatar-library-filter"><Select label="Library brand scope" value={selectedBrand} onChange={setSelectedBrand}><option value="">Choose explicit brand scope</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</Select></section><ErrorPanel error={error} />
    {selected ? <AvatarDetail avatar={selected} close={() => setSelected(null)} /> : <section className="avatar-library">{items.length ? items.map((item) => <button onClick={() => open(item)} key={item.id}><span className="eyebrow">{VERTICAL_LABELS[item.verticalCode]}</span><h2>{item.internalName}</h2><div><Badge value={item.subjectType} /><Badge value={item.consentApproved ? 'CONSENT APPROVED' : 'CONSENT BLOCKED'} /></div><strong>L{item.currentLevel} · {item.levelName}</strong>{item.blockingFailures?.length ? <small>{item.blockingFailures.join(' · ')}</small> : <small>Ready for next-level workflow</small>}</button>) : <div className="empty">{selectedBrand ? 'No avatars in this brand scope.' : 'Choose a brand to open the Avatar Library.'}</div>}</section>}</>;
}

function CreateAvatar({ brands, onCreated }) {
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [avatar, setAvatar] = useState(null); const [source, setSource] = useState(null); const [passport, setPassport] = useState(null);
  const [form, setForm] = useState({ vertical: 'PSYCHOLOGY_WELLBEING', brandId: '', internalName: '', subjectType: 'SYNTHETIC',
    role: '', intendedChannels: 'Instagram Reels', agePresentation: '', personality: '', languages: 'en', visualDirection: '',
    prohibitedUses: 'deception, political endorsement', consentArtifactId: '', consentArtifactVersion: '1',
    frontal: '', threeQuarter: '', profile: '' });
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const steps = ['Context','Identity','Source','Gate 0','Passport','Human approval','Level Up'];
  async function createIdentity() {
    setBusy(true); setError(null); try {
      const created = await api('/api/avatar-studio/avatars', { method: 'POST', body: JSON.stringify({
        vertical: form.vertical, brandIds: [form.brandId], internalName: form.internalName, subjectType: form.subjectType,
        intendedChannels: form.intendedChannels.split(',').map((item) => item.trim()), identity: {
          agePresentation: form.agePresentation, personality: form.personality, role: form.role,
          languages: form.languages.split(',').map((item) => item.trim()), visualDirection: form.visualDirection,
          permanentAttributes: {}, prohibitedUses: form.prohibitedUses.split(',').map((item) => item.trim()),
        }, consent: form.subjectType === 'SYNTHETIC' ? { status: 'APPROVED', rightsBasis: 'SYNTHETIC_IDENTITY' }
          : { status: 'APPROVED', rightsBasis: 'OPERATOR_ATTESTED_CONSENT', evidenceArtifactId: form.consentArtifactId,
            evidenceArtifactVersion: Number(form.consentArtifactVersion) }, humanApproval: form.subjectType !== 'SYNTHETIC',
        provenance: { source: 'AVATAR_STUDIO_WIZARD' },
      }) }); setAvatar(created); setStep(2);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function importSource() {
    setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/sources`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, source: {
      sourceType: 'SYNTHETIC_TRAITS', sourceLocator: `operator://avatar/${avatar.id}/identity-v1`, gate0Text: `${form.visualDirection} ${form.personality}`,
      provenance: { source: 'AVATAR_STUDIO_WIZARD', identityVersion: 1 },
    } }) }); setSource(result); setStep(3); } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function registerPassport() {
    setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/passports`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, sourceId: source.source.id,
      panels: [{ angle: 'FRONTAL', artifactId: form.frontal, artifactVersion: 1 }, { angle: 'THREE_QUARTER_45', artifactId: form.threeQuarter, artifactVersion: 1 }, { angle: 'PROFILE_90', artifactId: form.profile, artifactVersion: 1 }],
      qa: { samePerson: true, temporaryElementsExcluded: true },
    }) }); setPassport(result.passport); setAvatar(result.avatar); setStep(5); } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function certify() {
    setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/passports/${passport.id}/certify`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, decision: 'CERTIFIED', humanApproval: true,
      notes: 'Operator certified the exact three-panel candidate; temporary wardrobe/background excluded.' }) }); setAvatar(result.avatar); setStep(6); onCreated(); } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <section className="avatar-wizard"><div className="wizard-steps">{steps.map((name, index) => <span className={step === index ? 'active' : index < step ? 'done' : ''} key={name}>{index + 1} · {name}</span>)}</div><ErrorPanel error={error} />
    {step === 0 ? <div className="panel avatar-form"><h2>Context</h2><div className="form-grid"><Select label="Audience vertical" value={form.vertical} onChange={(v) => change('vertical', v)}>{Object.entries(VERTICAL_LABELS).map(([code,label]) => <option value={code} key={code}>{label}</option>)}</Select><Select label="Allowed brand" value={form.brandId} onChange={(v) => change('brandId', v)}><option value="">Choose brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</Select><Select label="Identity source type" value={form.subjectType} onChange={(v) => change('subjectType', v)}><option>SYNTHETIC</option><option>FOUNDER</option><option>CONSENTED_REAL_PERSON</option><option>APPROVED_CHARACTER</option></Select><Input label="Persona role" value={form.role} onChange={(v) => change('role', v)} /><Input label="Intended channels" value={form.intendedChannels} onChange={(v) => change('intendedChannels', v)} /></div><button className="primary" disabled={!form.brandId || !form.role} onClick={() => setStep(1)}>CONTINUE TO IDENTITY</button></div> : null}
    {step === 1 ? <div className="panel avatar-form"><h2>Identity</h2><p className="page-note">Permanent identity excludes wardrobe, accessories, props and environment.</p><div className="form-grid"><Input label="Internal avatar name" value={form.internalName} onChange={(v) => change('internalName', v)} /><Input label="Age presentation" value={form.agePresentation} onChange={(v) => change('agePresentation', v)} /><Input label="Personality" value={form.personality} onChange={(v) => change('personality', v)} /><Input label="Languages" value={form.languages} onChange={(v) => change('languages', v)} /><Input label="Visual direction" value={form.visualDirection} onChange={(v) => change('visualDirection', v)} /><Input label="Prohibited uses" value={form.prohibitedUses} onChange={(v) => change('prohibitedUses', v)} />{form.subjectType !== 'SYNTHETIC' ? <><Input label="Consent artifact ID" value={form.consentArtifactId} onChange={(v) => change('consentArtifactId', v)} /><Input label="Consent artifact version" value={form.consentArtifactVersion} onChange={(v) => change('consentArtifactVersion', v)} /></> : null}</div><button className="primary" disabled={busy} onClick={createIdentity}>{busy ? 'CREATING…' : 'CREATE AVATAR L0'}</button></div> : null}
    {step === 2 ? <div className="panel avatar-form"><h2>Source</h2><p>The exact L0 identity traits will be registered as an untrusted source with immutable provenance. No provider is called.</p><button className="primary" disabled={busy} onClick={importSource}>REGISTER SOURCE · RUN GATE 0</button></div> : null}
    {step === 3 ? <div className="panel avatar-form"><h2>Gate 0</h2><div className="gate-result"><Badge value={source.gate0.status} /><strong>{source.gate0.authority}</strong><span>{source.gate0.findings.length ? source.gate0.findings.map((item) => item.code).join(' · ') : 'No blocking or review findings'}</span><code>External calls: {source.gate0.externalCalls}</code></div><button className="primary" disabled={source.gate0.status === 'BLOCK'} onClick={() => setStep(4)}>CONTINUE TO PASSPORT</button></div> : null}
    {step === 4 ? <div className="panel avatar-form"><h2>Passport candidate</h2><p>Register three exact immutable artifact versions. Multiple candidates may be added before certification.</p><div className="form-grid"><Input label="Frontal artifact ID" value={form.frontal} onChange={(v) => change('frontal', v)} /><Input label="45-degree artifact ID" value={form.threeQuarter} onChange={(v) => change('threeQuarter', v)} /><Input label="90-degree profile artifact ID" value={form.profile} onChange={(v) => change('profile', v)} /></div><button className="primary" disabled={busy || !form.frontal || !form.threeQuarter || !form.profile} onClick={registerPassport}>REGISTER CANDIDATE</button></div> : null}
    {step === 5 ? <div className="panel avatar-form"><h2>Human approval</h2><div className="passport-panels">{[['FRONTAL',form.frontal],['45°',form.threeQuarter],['90° PROFILE',form.profile]].map(([label,id]) => <article key={label}><span>{label}</span><strong>{id}</strong><small>Immutable artifact v1</small></article>)}</div><div className="warning-panel">Certification is an explicit immutable human decision. It does not generate or publish content.</div><button className="primary" disabled={busy} onClick={certify}>CERTIFY THIS PASSPORT · LEVEL UP TO L1</button></div> : null}
    {step === 6 ? <div className="panel avatar-form"><h2>Level Up</h2><LevelLadder avatar={avatar} /><div className="avatar-summary"><div><span>CURRENT LEVEL</span><strong>L{avatar.currentLevel} · {avatar.currentLevelName}</strong></div><div><span>NEXT LEVEL</span><strong>{avatar.nextLevel ? `L${avatar.nextLevel.level} · ${avatar.nextLevel.name}` : 'COMPLETE'}</strong></div></div><div className="avatar-requirements"><article><h3>Completed</h3>{avatar.completedRequirements.map((item) => <code key={item}>{item}</code>)}</article><article><h3>Missing for next level</h3>{avatar.missingRequirements.map((item) => <code key={item}>{item}</code>)}</article><article><h3>Blocking failures</h3>{avatar.blockingFailures.length ? avatar.blockingFailures.map((item) => <code key={item}>{item}</code>) : <small>None</small>}</article></div></div> : null}
  </section>;
}

function TestContent({ brands }) {
  const [form, setForm] = useState({ vertical: 'PSYCHOLOGY_WELLBEING', brandId: '', avatarId: '', format: 'TALKING_HEAD', referenceSourceId: '', script: '', shots: 'Opening medium shot\nCloser explanation' });
  const [avatars, setAvatars] = useState([]); const [detail, setDetail] = useState(null); const [plan, setPlan] = useState(null); const [error, setError] = useState(null); const change = (key,value) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => { if (!form.brandId) return; api(`/api/avatar-studio/avatars?brandId=${form.brandId}&vertical=${form.vertical}`).then(setAvatars).catch(setError); }, [form.brandId, form.vertical]);
  useEffect(() => { if (!form.avatarId || !form.brandId) return; api(`/api/avatar-studio/avatars/${form.avatarId}?brandId=${form.brandId}`).then(setDetail).catch(setError); }, [form.avatarId, form.brandId]);
  async function compile(event) { event.preventDefault(); setError(null); setPlan(null); try { setPlan(await api('/api/avatar-studio/test-content/plan', { method: 'POST', body: JSON.stringify({ ...form,
      shotPlan: form.shots.split('\n').filter(Boolean).map((purpose,index) => ({ shotId: `shot-${index + 1}`, purpose })), script: { text: form.script } }) })); } catch (cause) { setError(cause); } }
  return <><ErrorPanel error={error} /><form className="panel avatar-form" onSubmit={compile}><h2>Plan-only Test Content</h2><p className="page-note">Vertical → brand → avatar → format → reference → script → shot plan → compiled provider plan.</p><div className="form-grid"><Select label="Test vertical" value={form.vertical} onChange={(v) => change('vertical',v)}>{Object.entries(VERTICAL_LABELS).map(([code,label]) => <option value={code} key={code}>{label}</option>)}</Select><Select label="Test brand" value={form.brandId} onChange={(v) => change('brandId',v)}><option value="">Choose brand</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</Select><Select label="Test avatar" value={form.avatarId} onChange={(v) => change('avatarId',v)}><option value="">Choose avatar</option>{avatars.map((avatar) => <option value={avatar.id} key={avatar.id}>{avatar.internalName} · L{avatar.currentLevel}</option>)}</Select><Select label="Test format" value={form.format} onChange={(v) => change('format',v)}><option>STATIC_PORTRAIT</option><option>TALKING_HEAD</option><option>MULTI_SHOT</option></Select><Select label="Approved reference" value={form.referenceSourceId} onChange={(v) => change('referenceSourceId',v)}><option value="">Choose Gate 0 PASS source</option>{(detail?.sources || []).filter((source) => source.gate0Status === 'PASS').map((source) => <option value={source.id} key={source.id}>{source.sourceType} · {source.id}</option>)}</Select><Input label="Script" value={form.script} onChange={(v) => change('script',v)} /><label className="wide">Shot plan<textarea aria-label="Shot plan" rows="4" value={form.shots} onChange={(event) => change('shots',event.target.value)} /></label></div><button className="primary" type="submit">COMPILE PLAN · ZERO PAID CALLS</button></form>{plan ? <section className="preflight avatar-plan"><Badge value="PLAN ONLY READY" /><h2>Compiled provider plan</h2><div className="avatar-summary"><div><span>Expected paid calls</span><strong>{plan.compiledProviderPlan.expectedPaidCalls}</strong></div><div><span>Expected external calls</span><strong>{plan.externalCallCount}</strong></div><div><span>Execution authorized</span><strong>{String(plan.compiledProviderPlan.executionAuthorized)}</strong></div><div><span>Human approval</span><strong>REQUIRED</strong></div></div><code>{plan.planFingerprint}</code></section> : null}</>;
}

export function AvatarStudio() {
  const [tab, setTab] = useState('LIBRARY'); const [brands, setBrands] = useState([]); const [selectedBrand, setSelectedBrand] = useState(''); const [revision, setRevision] = useState(0); const [error, setError] = useState(null);
  useEffect(() => { api('/api/brands').then(setBrands).catch(setError); }, []);
  const tabs = useMemo(() => ['LIBRARY','CREATE AVATAR','TEST CONTENT'], []);
  return <main><header className="page-header"><span className="eyebrow">PERSISTENT PERSONAS · LEVELS 0–7</span><h1>Avatar Studio</h1></header><p className="page-note">Identity, consent, references and level approvals remain brand-scoped, versioned and plan-only until a separate production preflight.</p><ErrorPanel error={error} /><div className="avatar-tabs">{tabs.map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>{tab === 'LIBRARY' ? <AvatarLibrary brands={brands} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} revision={revision} /> : null}{tab === 'CREATE AVATAR' ? <CreateAvatar brands={brands} onCreated={() => setRevision((value) => value + 1)} /> : null}{tab === 'TEST CONTENT' ? <TestContent brands={brands} /> : null}</main>;
}

export { AvatarDetail, AvatarLibrary, CreateAvatar, LevelLadder, TestContent };
