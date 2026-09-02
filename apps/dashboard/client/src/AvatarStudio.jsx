import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { PassportLab } from './PassportLab';
import { BodyExpressionsLab } from './BodyExpressionsLab';
import './AvatarStudio.css';

const LEVEL_NAMES = ['IDENTITY','PASSPORT','BODY EXPRESSIONS','WARDROBE','VOICE','LOCATIONS','PERFORMANCE','MULTISHOT CONTINUITY'];
const VERTICAL_LABELS = {
  PSYCHOLOGY_WELLBEING: 'Psychology & Wellbeing', CONSTRUCTION_RENOVATION: 'Construction & Renovation',
  LUXURY_LIFESTYLE: 'Luxury Lifestyle', TRAVEL: 'Travel',
};
const SUPPORTED_UPLOAD_IMAGE_TYPES = ['image/jpeg','image/png','image/webp'];
const SUPPORTED_UPLOAD_IMAGE_EXTENSIONS = ['.jpg','.jpeg','.png','.webp'];

function uploadFormatError(file) {
  const type = String(file?.type || '').toLowerCase(); const name = String(file?.name || '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if ((type.startsWith('image/') && !SUPPORTED_UPLOAD_IMAGE_TYPES.includes(type))
    || ['.heic','.heif','.avif','.gif','.tif','.tiff','.bmp'].includes(extension)) {
    return { code: 'FORMAT_UNSUPPORTED', message: 'Unsupported source-image format. Avatar Studio accepts JPEG/JPG, PNG, and WebP. HEIC/HEIF is not currently decoded; the file was not uploaded.' };
  }
  if (!type && extension && !SUPPORTED_UPLOAD_IMAGE_EXTENSIONS.includes(extension)) {
    return { code: 'FORMAT_UNSUPPORTED', message: 'The file has no usable media type and its extension is not in the Avatar Studio upload contract.' };
  }
  return null;
}

function Badge({ value }) { return <span className={`avatar-badge avatar-${String(value || '').toLowerCase()}`}>{String(value || 'NOT STARTED').replaceAll('_', ' ')}</span>; }
function ErrorPanel({ error }) { return error ? <div className="error-panel"><strong>{error.code}</strong><p>{error.message}</p></div> : null; }
function Select({ label, value, onChange, children, required = true }) { return <label>{label}<select aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Input({ label, value, onChange, required = true }) { return <label>{label}<input aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function filePayload(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject;
  reader.onload = () => resolve({ name: file.name, mimeType: file.type, contentBase64: String(reader.result).split(',')[1], capturedAt: new Date().toISOString() });
  reader.readAsDataURL(file); }); }

function LevelLadder({ avatar }) {
  const state = avatar?.levelState || avatar;
  return <div className="avatar-levels">{LEVEL_NAMES.map((name, level) => <article className={level <= (state?.currentLevel ?? 0) ? 'complete' : level === (state?.currentLevel ?? 0) + 1 ? 'next' : ''} key={name}>
    <span>L{level}</span><strong>{name}</strong><small>{level <= (state?.currentLevel ?? 0) ? 'COMPLETE' : level === (state?.currentLevel ?? 0) + 1 ? 'NEXT' : 'LOCKED'}</small>
  </article>)}</div>;
}

function LevelUpWorkflow({ avatar, brandId, onUpdated }) {
  const next = (avatar.levelState || avatar).nextLevel; const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [form, setForm] = useState({ chest: '', standing: '', seated: '', neutral: '', warm: '', serious: '', wardrobeName: '', clothing: '',
    voiceName: '', voiceLanguage: 'en', voiceSourceType: 'SYNTHETIC', consentRecordId: '', consentEventId: '', locationName: '', locationArtifact: '',
    perspective: 'centered eye-level', cameraHeight: 'eye-level', lensCharacter: 'natural 50mm', lightDirection: 'camera left',
    lightTemperature: '4300K', width: '1080', height: '1920', preset: 'CALM_EXPERT', snapshotId: '', approved: false });
  if (!next) return <section className="level-up-workflow"><h3>First-slice levels complete</h3><p>L7 is ready. Production remains behind a separate preflight and human approval.</p></section>;
  const change = (key,value) => setForm((current) => ({ ...current, [key]: value }));
  async function add(type, value) { return api(`/api/avatar-studio/avatars/${avatar.id}/level-assets`, { method: 'POST', body: JSON.stringify({ brandId, type, value: { ...value, approvalStatus: 'APPROVED' }, humanApproval: true }) }); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null); try { let result;
      if (next.level === 2) {
        for (const [kind,artifactId] of [['CHEST_UP',form.chest],['FULL_BODY_STANDING',form.standing],['SEATED',form.seated]]) result = await add('BODY', { kind, artifactId, artifactVersion: 1, provenance: { source: 'AVATAR_DETAIL_LEVEL_UP' } });
        for (const [expression,artifactId] of [['NEUTRAL',form.neutral],['WARM_SMILE',form.warm],['CONCERNED_SERIOUS',form.serious]]) result = await add('EXPRESSION', { expression, artifactId, artifactVersion: 1, provenance: { source: 'AVATAR_DETAIL_LEVEL_UP' } });
      } else if (next.level === 3) result = await add('WARDROBE', { name: form.wardrobeName, clothingDescription: form.clothing,
        allowedBrandIds: [brandId], allowedVerticals: [avatar.vertical], provenance: { source: 'AVATAR_DETAIL_LEVEL_UP' } });
      else if (next.level === 4) result = await add('VOICE', { name: form.voiceName, language: form.voiceLanguage,
        sourceType: form.voiceSourceType, consentRecordId: form.consentRecordId || null, consentEventId: form.consentEventId || null,
        deliveryPresets: ['CALM_EXPERT'], provenance: { source: 'AVATAR_DETAIL_LEVEL_UP' } });
      else if (next.level === 5) result = await add('LOCATION', { name: form.locationName, environmentArtifactId: form.locationArtifact,
        environmentArtifactVersion: 1, perspective: { description: form.perspective }, cameraHeight: form.cameraHeight,
        lensCharacter: form.lensCharacter, lightingDirection: form.lightDirection, lightingTemperature: form.lightTemperature,
        referenceGeometry: { width: Number(form.width), height: Number(form.height) }, keyGeometryObjects: [],
        rightsProvenance: { attestedBy: 'dashboard-operator' }, allowedVerticals: [avatar.vertical] });
      else if (next.level === 6) result = await add('PERFORMANCE', { preset: form.preset, motionSpec: {}, failureNotes: [], provenance: { source: 'AVATAR_DETAIL_LEVEL_UP' } });
      else if (next.level === 7) result = await add('CONTINUITY', { continuitySnapshotId: form.snapshotId, identity: { status: 'PASS' },
        wardrobe: { status: 'PASS' }, props: { status: 'PASS' }, location: { status: 'PASS' }, geometry: { status: 'PASS' },
        voice: { status: 'PASS' }, lipSync: { status: 'PASS' }, evidence: { source: 'CANONICAL_CONTINUITY_SNAPSHOT' } });
      onUpdated(result.avatar);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  if (next.level === 1) return <section className="level-up-workflow"><h3>Next level · L1 PASSPORT</h3><p>Use Create Avatar to register Gate 0 source evidence, compare multiple three-angle candidates, and make the immutable human certification.</p></section>;
  if (next.level === 2) return <section className="level-up-workflow"><h3>Next level · L2 BODY_EXPRESSIONS</h3><p>Open BODY + EXPRESSIONS LAB. Six individual reference certifications and one final explicit pack certification are required; legacy artifact IDs cannot advance L2.</p></section>;
  return <form className="level-up-workflow avatar-form" onSubmit={submit}><span className="eyebrow">EXACTLY ONE NEXT-LEVEL WORKFLOW</span><h3>Next level · L{next.level} {next.name}</h3><ErrorPanel error={error} /><div className="form-grid">
    {next.level === 2 ? <>{[['Chest-up artifact ID','chest'],['Full-body standing artifact ID','standing'],['Seated artifact ID','seated'],['Neutral expression artifact ID','neutral'],['Warm expression artifact ID','warm'],['Serious expression artifact ID','serious']].map(([label,key]) => <Input key={key} label={label} value={form[key]} onChange={(v) => change(key,v)} />)}</> : null}
    {next.level === 3 ? <><Input label="Wardrobe pack name" value={form.wardrobeName} onChange={(v) => change('wardrobeName',v)} /><Input label="Clothing description" value={form.clothing} onChange={(v) => change('clothing',v)} /></> : null}
    {next.level === 4 ? <><Input label="Voice profile name" value={form.voiceName} onChange={(v) => change('voiceName',v)} /><Input label="Voice language" value={form.voiceLanguage} onChange={(v) => change('voiceLanguage',v)} /><Select label="Voice source type" value={form.voiceSourceType} onChange={(v) => change('voiceSourceType',v)}><option>SYNTHETIC</option><option>OWNED_RECORDING</option><option>CONSENTED_CLONE</option></Select>{form.voiceSourceType !== 'SYNTHETIC' ? <><Select label="Voice consent event" value={form.consentEventId} onChange={(v) => change('consentEventId',v)}><option value="">Choose V1.1 voice consent</option>{(avatar.consentEvents || []).filter((item) => item.modality === 'VOICE' && item.status === 'APPROVED').map((item) => <option value={item.id} key={item.id}>VOICE · {item.id}</option>)}</Select>{!form.consentEventId ? <Select label="Legacy voice consent record" value={form.consentRecordId} onChange={(v) => change('consentRecordId',v)}><option value="">Choose legacy approved consent</option>{(avatar.consentRecords || []).filter((item) => item.status === 'APPROVED').map((item) => <option value={item.id} key={item.id}>{item.scope} · {item.id}</option>)}</Select> : null}</> : null}</> : null}
    {next.level === 5 ? <>{[['Location pack name','locationName'],['Environment artifact ID','locationArtifact'],['Perspective','perspective'],['Camera height','cameraHeight'],['Lens character','lensCharacter'],['Lighting direction','lightDirection'],['Lighting temperature','lightTemperature'],['Reference width','width'],['Reference height','height']].map(([label,key]) => <Input key={key} label={label} value={form[key]} onChange={(v) => change(key,v)} />)}</> : null}
    {next.level === 6 ? <Select label="Performance preset" value={form.preset} onChange={(v) => change('preset',v)}>{['CALM_EXPERT','ENERGETIC_WARM','QUIET_FRIENDLY','FIRM_DIRECT','WALKING_VLOGGER','PRODUCT_DEMO','REACTION'].map((item) => <option key={item}>{item}</option>)}</Select> : null}
    {next.level === 7 ? <><Input label="Canonical continuity snapshot ID" value={form.snapshotId} onChange={(v) => change('snapshotId',v)} /><label className="check wide"><input aria-label="Approve all L7 continuity families" required type="checkbox" checked={form.approved} onChange={(event) => change('approved',event.target.checked)} />I reviewed identity, wardrobe, props, location geometry, voice and lip sync evidence.</label></> : null}
  </div><div className="warning-panel">Submitting records an explicit human approval. It never starts provider generation or publication.</div><button className="primary" disabled={busy || (next.level === 7 && !form.approved)} type="submit">{busy ? 'RECORDING…' : `APPROVE LEVEL ${next.level}`}</button></form>;
}

function AvatarDetail({ avatar, brandId, close, onUpdated }) {
  if (!avatar) return null;
  const state = avatar.levelState || avatar;
  return <section className="avatar-detail"><div className="avatar-detail-head"><div><span className="eyebrow">AVATAR DETAIL</span><h2>{avatar.internalName}</h2></div><button className="secondary" onClick={close}>CLOSE</button></div>
    <div className="avatar-summary"><div><span>CURRENT LEVEL</span><strong>L{state.currentLevel} · {state.currentLevelName || state.levelName}</strong></div><div><span>NEXT LEVEL</span><strong>{state.nextLevel ? `L${state.nextLevel.level} · ${state.nextLevel.name}` : 'MAX FIRST-SLICE LEVEL'}</strong></div><div><span>VERTICAL</span><strong>{VERTICAL_LABELS[avatar.vertical || avatar.verticalCode]}</strong></div><div><span>CONSENT</span><Badge value={avatar.consentApproved || avatar.consent?.status || 'APPROVED'} /></div></div>
    <LevelLadder avatar={avatar} />
    <div className="avatar-requirements"><article><h3>Completed requirements</h3>{(state.completedRequirements || []).map((item) => <code key={item}>{item}</code>)}</article><article><h3>Missing requirements</h3>{(state.missingRequirements || []).length ? state.missingRequirements.map((item) => <code key={item}>{item}</code>) : <small>None</small>}</article><article><h3>Blocking failures</h3>{(state.blockingFailures || []).length ? state.blockingFailures.map((item) => <code key={item}>{item}</code>) : <small>None</small>}</article></div>
    <div className="avatar-pack-grid">{[['Passport candidates',avatar.passports],['Wardrobe packs',avatar.wardrobes],['Voice profiles',avatar.voiceProfiles],['Location packs',avatar.locations],['Performance packs',avatar.performancePacks]].map(([label,items]) => <article key={label}><span>{label}</span><strong>{items?.length || 0}</strong></article>)}</div><LevelUpWorkflow avatar={avatar} brandId={brandId} onUpdated={onUpdated} />
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
    {selected ? <AvatarDetail avatar={selected} brandId={selectedBrand} onUpdated={setSelected} close={() => setSelected(null)} /> : <section className="avatar-library">{items.length ? items.map((item) => <button onClick={() => open(item)} key={item.id}><span className="eyebrow">{VERTICAL_LABELS[item.verticalCode]}</span><h2>{item.internalName}</h2><div><Badge value={item.subjectType} /><Badge value={item.consentApproved ? 'CONSENT APPROVED' : 'CONSENT BLOCKED'} /></div><strong>L{item.currentLevel} · {item.levelName}</strong>{item.blockingFailures?.length ? <small>{item.blockingFailures.join(' · ')}</small> : <small>Ready for next-level workflow</small>}</button>) : <div className="empty">{selectedBrand ? 'No avatars in this brand scope.' : 'Choose a brand to open the Avatar Library.'}</div>}</section>}</>;
}

function CreateAvatar({ brands, onCreated }) {
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [avatar, setAvatar] = useState(null); const [intake, setIntake] = useState(null); const [mode, setMode] = useState('UPLOAD');
  const [existing, setExisting] = useState([]); const [existingId, setExistingId] = useState(''); const [safeUrl, setSafeUrl] = useState('');
  const [roles, setRoles] = useState(['IDENTITY','PASSPORT_SOURCE']); const [capture, setCapture] = useState(null);
  const [consentEvidence, setConsentEvidence] = useState(null); const [consentLink, setConsentLink] = useState(null);
  const [form, setForm] = useState({ vertical: 'PSYCHOLOGY_WELLBEING', brandId: '', internalName: '', subjectType: 'SYNTHETIC',
    role: '', intendedChannels: 'Instagram Reels', agePresentation: '', personality: '', languages: 'en', visualDirection: '',
    prohibitedUses: 'deception, political endorsement', consentName: '', consentBasis: 'SIGNED_RELEASE', consentEvidence: '', consentDisclosure: false,
    lockPermanent: 'facialStructure=preserve, apparentAge=preserve, nose=preserve, jaw=preserve, hairline=preserve',
    lockTemporary: 'hat=exclude, jacket=exclude, wardrobe=exclude, background=exclude, lighting=exclude', lockUncertain: 'glasses=operator decision' });
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const steps = ['Context','Asset intake','Gate 0 + consent','Identity','Identity Lock','Passport Lab ready'];
  useEffect(() => { if (mode !== 'EXISTING_ASSET' || !avatar) return;
    api(`/api/avatar-studio/avatars/${avatar.id}/existing-assets?brandId=${encodeURIComponent(form.brandId)}`).then(setExisting).catch(setError);
  }, [mode, avatar, form.brandId]);
  async function startDraft() {
    setBusy(true); setError(null); try {
      const created = await api('/api/avatar-studio/avatars', { method: 'POST', body: JSON.stringify({
        vertical: form.vertical, brandIds: [form.brandId], internalName: form.internalName, subjectType: form.subjectType,
        intendedChannels: form.intendedChannels.split(',').map((item) => item.trim()), identity: {
          agePresentation: 'TO_BE_DEFINED', personality: 'TO_BE_DEFINED', role: form.role,
          languages: ['und'], visualDirection: 'TO_BE_DEFINED',
          permanentAttributes: {}, prohibitedUses: form.prohibitedUses.split(',').map((item) => item.trim()),
        }, consent: form.subjectType === 'SYNTHETIC' ? { status: 'APPROVED', rightsBasis: 'SYNTHETIC_IDENTITY' }
          : { status: 'REVIEW', rightsBasis: 'UNVERIFIED_PENDING_CONSENT' },
        provenance: { source: 'AVATAR_STUDIO_INTAKE_DRAFT', identityState: 'PROVISIONAL' },
      }) }); setAvatar(created); setStep(1);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function submitIntake({ file = null, sourceType = mode } = {}) {
    const formatError = file && sourceType === 'UPLOAD' ? uploadFormatError(file) : null;
    if (formatError) { setError(formatError); return; }
    setBusy(true); setError(null); try { const payload = { brandId: form.brandId, sourceType,
      provenance: { owner: form.subjectType === 'SYNTHETIC' ? 'SYNTHETIC' : undefined, source: 'AVATAR_STUDIO_BROWSER_INTAKE' } };
      if (file) payload.file = await filePayload(file);
      if (sourceType === 'EXISTING_ASSET') payload.existingAssetId = existingId;
      if (sourceType === 'SAFE_URL_IMPORT') payload.url = safeUrl;
      const result = await api(`/api/avatar-studio/avatars/${avatar.id}/intakes`, { method: 'POST', body: JSON.stringify(payload) });
      setIntake(result); setStep(2);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function submitConsentEvidence(file, sourceType) { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/intakes`, { method: 'POST', body: JSON.stringify({
      brandId: form.brandId, sourceType, file: await filePayload(file), provenance: { owner: 'SELF_RECORDED_CONSENT', source: 'LOCAL_CONSENT_CAPTURE' } }) });
      setConsentEvidence(result.asset);
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function startCapture(kind, consentEvidenceCapture = false) {
    setError(null); try { const stream = await navigator.mediaDevices.getUserMedia(kind === 'CAMERA' ? { video: true, audio: false } : { audio: true });
      const chunks = []; const recorder = new MediaRecorder(stream); recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => { const mimeType = recorder.mimeType || (kind === 'CAMERA' ? 'video/webm' : 'audio/webm');
        const file = new File(chunks, `${kind.toLowerCase()}-${Date.now()}.webm`, { type: mimeType }); stream.getTracks().forEach((track) => track.stop()); setCapture(null);
        if (consentEvidenceCapture) await submitConsentEvidence(file, kind); else await submitIntake({ file, sourceType: kind }); };
      recorder.start(); setCapture({ kind, recorder, consentEvidence: consentEvidenceCapture });
    } catch (cause) { setError({ code: 'CAPTURE_UNAVAILABLE', message: cause.message }); }
  }
  async function review(action) { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${intake.asset.id}/review`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, action,
      reason: action === 'APPROVE_FOR_USE' ? 'Operator reviewed all Gate 0 findings and approved this exact immutable version.' : 'Operator verified rights evidence.', humanApproval: true }) });
      setIntake((current) => ({ ...current, asset: result.asset, sourceReadiness: result.asset.sourceReadiness,
        gate0: { ...current.gate0, status: result.asset.effectiveGate0Status } }));
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function grantConsent() { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${intake.asset.id}/consents`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId,
      modality: 'FACE', subjectIdentity: { name: form.consentName }, rightsBasis: form.consentBasis, allowedBrandIds: [form.brandId],
      allowedVerticals: [form.vertical], allowedChannels: form.intendedChannels.split(',').map((item) => item.trim()),
      allowedUseTypes: ['AVATAR_IDENTITY','PASSPORT_REFERENCE'], evidenceNotes: form.consentEvidence,
      evidenceIntakeId: consentEvidence?.id || null,
      disclosureAccepted: form.consentDisclosure, humanApproval: true }) }); setIntake((current) => ({ ...current, asset: result.asset,
        sourceReadiness: result.asset.sourceReadiness }));
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function reviewConsentEvidence() { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${consentEvidence.id}/review`, { method: 'POST', body: JSON.stringify({
      brandId: form.brandId, action: 'APPROVE_FOR_USE', reason: 'Operator reviewed this exact local consent recording.', humanApproval: true }) }); setConsentEvidence(result.asset);
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function requestRemoteConsent() { setBusy(true); setError(null); try { setConsentLink(await api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${intake.asset.id}/consent-requests`, { method: 'POST', body: JSON.stringify({
      brandId: form.brandId, modality: 'FACE', disclosureText: `I consent to use of this exact face reference for ${form.internalName}, ${form.vertical}, brand ${form.brandId}, channels ${form.intendedChannels}.` }) }));
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function useSource() { setBusy(true); setError(null); try { await api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${intake.asset.id}/use`, { method: 'POST', body: JSON.stringify({ brandId: form.brandId, roles }) });
      setStep(3);
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  async function saveIdentity() { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/identity`, { method: 'POST', body: JSON.stringify({
      brandId: form.brandId, identity: { agePresentation: form.agePresentation, personality: form.personality, role: form.role,
        languages: form.languages.split(',').map((item) => item.trim()), visualDirection: form.visualDirection,
        permanentAttributes: {}, prohibitedUses: form.prohibitedUses.split(',').map((item) => item.trim()) },
      provenance: { source: 'AVATAR_STUDIO_IDENTITY_AFTER_INTAKE', intakeAssetId: intake.asset.id } }) });
      setAvatar(result.avatar); setStep(4);
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  function classifications(value) { return Object.fromEntries(String(value).split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [key,...rest] = item.split('='); return [key.trim(),rest.join('=').trim() || 'explicit operator classification']; })); }
  async function saveIdentityLock() { setBusy(true); setError(null); try { const result = await api(`/api/avatar-studio/avatars/${avatar.id}/identity-locks`, { method: 'POST', body: JSON.stringify({
      brandId: form.brandId, permanent: classifications(form.lockPermanent), temporary: classifications(form.lockTemporary),
      uncertain: classifications(form.lockUncertain), notes: 'Classified in Create Avatar wizard', humanApproval: true,
      provenance: { source: 'CREATE_AVATAR_IDENTITY_LOCK_STEP' } }) }); setAvatar(result.avatar); setStep(5); onCreated();
    } catch (cause) { setError(cause); } finally { setBusy(false); } }
  function toggleRole(role) { setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]); }
  const gateStatus = intake?.asset?.effectiveGate0Status || intake?.gate0?.status;
  const readiness = intake?.asset?.sourceReadiness || intake?.sourceReadiness || (gateStatus === 'PASS'
    ? { state: 'SOURCE READY', reason: 'The source decoded successfully and passed the current technical and Gate 0 checks.' }
    : { state: 'REVIEW REQUIRED', reason: 'Review the bounded intake findings.' });
  return <section className="avatar-wizard"><div className="wizard-steps">{steps.map((name, index) => <span className={step === index ? 'active' : index < step ? 'done' : ''} key={name}>{index + 1} · {name}</span>)}</div><ErrorPanel error={error} />
    {step === 0 ? <div className="panel avatar-form"><h2>Context</h2><div className="form-grid"><Select label="Audience vertical" value={form.vertical} onChange={(v) => change('vertical', v)}>{Object.entries(VERTICAL_LABELS).map(([code,label]) => <option value={code} key={code}>{label}</option>)}</Select><Select label="Allowed brand" value={form.brandId} onChange={(v) => change('brandId', v)}><option value="">Choose brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</Select><Select label="Identity source type" value={form.subjectType} onChange={(v) => change('subjectType', v)}><option>SYNTHETIC</option><option>FOUNDER</option><option>CONSENTED_REAL_PERSON</option><option>APPROVED_CHARACTER</option></Select><Input label="Internal avatar name" value={form.internalName} onChange={(v) => change('internalName', v)} /><Input label="Persona role" value={form.role} onChange={(v) => change('role', v)} /><Input label="Intended channels" value={form.intendedChannels} onChange={(v) => change('intendedChannels', v)} /></div><button className="primary" disabled={busy || !form.brandId || !form.role || !form.internalName} onClick={startDraft}>{busy ? 'CREATING DRAFT…' : 'START ASSET INTAKE'}</button></div> : null}
    {step === 1 ? <div className="panel avatar-form"><h2>Asset intake</h2><p>Choose an explicit source path. Every byte is versioned immutably and Gate 0 runs immediately.</p><div className="intake-modes">{['UPLOAD','CAMERA','MICROPHONE','EXISTING_ASSET','SAFE_URL_IMPORT'].map((item) => <button type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)} key={item}>{item.replaceAll('_',' ')}</button>)}</div>
      {mode === 'UPLOAD' ? <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) submitIntake({ file }); }}><strong>Drop a supported source here</strong><span>Images: JPEG/JPG, PNG, WebP · HEIC/HEIF is not supported · maximum 25 MB</span><input aria-label="Avatar source file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm" onChange={(event) => event.target.files[0] && submitIntake({ file: event.target.files[0] })} /></label> : null}
      {mode === 'CAMERA' || mode === 'MICROPHONE' ? <div className="capture-box"><p>{mode === 'CAMERA' ? 'Camera video stays local until you stop and submit the recording.' : 'Microphone audio stays local until you stop and submit the recording.'}</p>{capture?.kind === mode ? <button className="primary" onClick={() => capture.recorder.stop()}>STOP &amp; INTAKE</button> : <button className="primary" onClick={() => startCapture(mode)}>START {mode}</button>}</div> : null}
      {mode === 'EXISTING_ASSET' ? <div className="form-grid"><Select label="Existing Content Factory artifact" value={existingId} onChange={setExistingId}><option value="">Choose brand-scoped immutable artifact</option>{existing.map((item) => <option value={item.id} key={item.id}>{item.kind} · {item.artifactId} · v{item.artifactVersion}</option>)}</Select><button className="primary" disabled={!existingId || busy} onClick={() => submitIntake()}>SELECT &amp; RUN GATE 0</button></div> : null}
      {mode === 'SAFE_URL_IMPORT' ? <div className="form-grid"><Input label="Explicit HTTPS asset URL" value={safeUrl} onChange={setSafeUrl} /><button className="primary" disabled={!safeUrl || busy} onClick={() => submitIntake()}>SAFE IMPORT &amp; RUN GATE 0</button></div> : null}</div> : null}
    {step === 2 && intake ? <div className="panel avatar-form"><h2>Gate 0, rights and source roles</h2><div className="intake-preview"><div>{intake.asset.mimeType.startsWith('image/') ? <img alt="Avatar source preview" src={intake.asset.previewUrl} /> : intake.asset.mimeType.startsWith('video/') ? <video controls src={intake.asset.previewUrl} /> : <audio controls src={intake.asset.previewUrl} />}</div><dl><dt>Source readiness</dt><dd><Badge value={readiness.state} /><p>{readiness.reason}</p></dd><dt>Gate 0</dt><dd><Badge value={gateStatus} /> · {intake.gate0?.policyVersion || intake.asset.gate0PolicyVersion}</dd><dt>Artifact</dt><dd>{intake.asset.artifactId} · v{intake.asset.artifactVersion}</dd><dt>SHA-256</dt><dd><code>{intake.asset.contentHash}</code></dd><dt>Media</dt><dd>{intake.mediaAnalysis?.originalFilename || intake.asset.originalFilename || '—'} · declared {intake.mediaAnalysis?.declaredMime || intake.asset.mimeType} · detected {intake.mediaAnalysis?.detectedMime || '—'} · {intake.asset.byteSize} bytes · {intake.asset.width || '—'}×{intake.asset.height || '—'} · {intake.mediaAnalysis?.orientation || '—'}</dd><dt>Encoding</dt><dd>{intake.mediaAnalysis?.encoding?.codec || '—'} · {intake.mediaAnalysis?.encoding?.pixelFormat || 'pixel format unavailable'}</dd><dt>Metadata parser</dt><dd>{intake.mediaAnalysis?.metadataParser?.parser || '—'} · {intake.mediaAnalysis?.metadataParser?.status || '—'} · bounded structured metadata only</dd><dt>Rights</dt><dd><Badge value={intake.asset.effectiveRightsStatus} /></dd></dl></div>
      <div className="gate-result">{intake.asset.gate0Findings?.length ? <ul>{intake.asset.gate0Findings.map((item) => <li key={`${item.severity}:${item.code}`}><strong>{item.code}</strong> · {item.explanation || 'Bounded intake policy finding.'}</li>)}</ul> : <span>No blocking or review findings</span>}<code>Paid provider calls: 0 · External generation calls: 0</code></div>
      {gateStatus === 'REVIEW' ? <div className="review-actions"><button className="secondary" disabled={busy} onClick={() => review('MARK_RIGHTS_VERIFIED')}>MARK RIGHTS VERIFIED</button><button className="primary" disabled={busy} onClick={() => review('APPROVE_FOR_USE')}>APPROVE FOR USE</button></div> : null}
      {form.subjectType !== 'SYNTHETIC' ? <div className="consent-capture"><h3>Face consent</h3><p className="warning-panel">Before recording or approving: the person must understand that this exact image may be used to build an avatar for the selected brand, vertical and channels.</p><div className="form-grid"><Input label="Consenting person identity" value={form.consentName} onChange={(v) => change('consentName',v)} /><Input label="Rights basis" value={form.consentBasis} onChange={(v) => change('consentBasis',v)} /><Input label="Consent evidence notes" value={form.consentEvidence} onChange={(v) => change('consentEvidence',v)} /><label className="check wide"><input aria-label="Consent disclosure accepted" type="checkbox" checked={form.consentDisclosure} onChange={(event) => change('consentDisclosure',event.target.checked)} />I showed the explicit consent text before recording or approval.</label></div><div className="review-actions"><button className="secondary" disabled={busy || !form.consentDisclosure} onClick={() => startCapture('CAMERA',true)}>RECORD LOCAL CONSENT VIDEO</button><button className="secondary" disabled={busy || !form.consentDisclosure} onClick={() => startCapture('MICROPHONE',true)}>RECORD LOCAL CONSENT AUDIO</button>{capture?.consentEvidence ? <button className="primary" onClick={() => capture.recorder.stop()}>STOP CONSENT RECORDING</button> : null}<button className="secondary" disabled={busy} onClick={requestRemoteConsent}>CREATE REMOTE CONSENT LINK / QR FOUNDATION</button></div>{consentEvidence ? <div className="gate-result"><Badge value={consentEvidence.effectiveGate0Status} /><span>Immutable consent evidence · {consentEvidence.mimeType} · {consentEvidence.artifactId} v{consentEvidence.artifactVersion}</span>{consentEvidence.effectiveGate0Status === 'REVIEW' ? <button onClick={reviewConsentEvidence}>APPROVE CONSENT EVIDENCE</button> : null}</div> : null}{consentLink ? <div className="gate-result"><strong>Copy consent link</strong><code>{consentLink.consentPath}</code><span>No message was sent; token state is durable.</span></div> : null}<button className="secondary" disabled={busy || !form.consentDisclosure || (!form.consentEvidence && consentEvidence?.effectiveGate0Status !== 'PASS')} onClick={grantConsent}>RECORD APPEND-ONLY FACE CONSENT</button></div> : null}
      <fieldset className="source-roles"><legend>Explicit source roles</legend>{['IDENTITY','PASSPORT_SOURCE','VOICE_SOURCE','WARDROBE','PRODUCT','LOCATION','STYLE_REFERENCE','PREVIOUS_SHOT'].map((role) => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />{role.replaceAll('_',' ')}</label>)}</fieldset>
      <button className="primary" disabled={busy || gateStatus !== 'PASS' || !roles.length} onClick={useSource}>USE AS AVATAR SOURCE</button></div> : null}
    {step === 3 ? <div className="panel avatar-form"><h2>Identity</h2><p className="page-note">The approved source is evidence, not identity text. Define permanent traits now; wardrobe, accessories, props and environment remain separate.</p><div className="form-grid"><Input label="Age presentation" value={form.agePresentation} onChange={(v) => change('agePresentation', v)} /><Input label="Personality" value={form.personality} onChange={(v) => change('personality', v)} /><Input label="Languages" value={form.languages} onChange={(v) => change('languages', v)} /><Input label="Visual direction" value={form.visualDirection} onChange={(v) => change('visualDirection', v)} /><Input label="Prohibited uses" value={form.prohibitedUses} onChange={(v) => change('prohibitedUses', v)} /></div><button className="primary" disabled={busy} onClick={saveIdentity}>{busy ? 'SAVING IDENTITY…' : 'SAVE IMMUTABLE IDENTITY VERSION'}</button></div> : null}
    {step === 4 ? <div className="panel avatar-form"><h2>Identity Lock</h2><p className="page-note">Classify what is permanent, temporary and uncertain. A hat, jacket, wardrobe, background or location never becomes identity by accident.</p><label>PERMANENT<textarea aria-label="Wizard Identity Lock permanent" rows="4" value={form.lockPermanent} onChange={(event) => change('lockPermanent',event.target.value)} /></label><label>TEMPORARY / NON-IDENTITY<textarea aria-label="Wizard Identity Lock temporary" rows="4" value={form.lockTemporary} onChange={(event) => change('lockTemporary',event.target.value)} /></label><label>UNCERTAIN<textarea aria-label="Wizard Identity Lock uncertain" rows="3" value={form.lockUncertain} onChange={(event) => change('lockUncertain',event.target.value)} /></label><button className="primary" disabled={busy} onClick={saveIdentityLock}>{busy ? 'LOCKING…' : 'SAVE IMMUTABLE IDENTITY LOCK'}</button></div> : null}
    {step === 5 ? <div className="panel avatar-form"><h2>Ready for Passport Lab</h2><Badge value="L0 IDENTITY" /><p>The source, Identity version and Identity Lock are immutable. The avatar remains L0. Only human certification of one valid Passport Lab candidate can create L1.</p><LevelLadder avatar={avatar} /></div> : null}
  </section>;
}

function Gate0ReviewQueue({ brands }) {
  const [brandId,setBrandId] = useState(''); const [items,setItems] = useState([]); const [error,setError] = useState(null);
  async function load(value = brandId) { if (!value) return setItems([]); try { setItems(await api(`/api/avatar-studio/gate0-reviews?brandId=${encodeURIComponent(value)}`)); } catch (cause) { setError(cause); } }
  useEffect(() => { load(brandId); }, [brandId]);
  async function decide(item, action) { try { await api(`/api/avatar-studio/avatars/${item.characterId}/intakes/${item.id}/review`, { method: 'POST', body: JSON.stringify({ brandId,
    action, reason: `Gate 0 queue decision: ${action}`, humanApproval: true }) }); await load(); } catch (cause) { setError(cause); } }
  return <><section className="panel avatar-library-filter"><Select label="Gate 0 review brand scope" value={brandId} onChange={setBrandId}><option value="">Choose explicit brand scope</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</Select></section><ErrorPanel error={error} /><section className="review-queue">{items.map((item) => <article key={item.id}><div className="review-preview">{item.mimeType.startsWith('image/') ? <img alt="Gate 0 asset preview" src={item.previewUrl} /> : <span>{item.mimeType}</span>}</div><div><Badge value={item.effectiveGate0Status} /><h3>{item.originalFilename}</h3><p>{item.sourceType} · {item.uploader} · {item.createdAt}</p><p>{item.gate0Findings.map((finding) => finding.code).join(' · ')}</p><small>{item.workspaceId} · {item.brandId} · {item.verticalCode}</small></div><div className="review-actions"><button onClick={() => decide(item,'APPROVE_FOR_USE')}>APPROVE FOR USE</button><button onClick={() => decide(item,'REJECT')}>REJECT</button><button onClick={() => decide(item,'REQUEST_CONSENT')}>REQUEST CONSENT</button><button onClick={() => decide(item,'MARK_RIGHTS_VERIFIED')}>MARK RIGHTS VERIFIED</button><button onClick={() => decide(item,'KEEP_BLOCKED')}>KEEP BLOCKED</button></div></article>)}{brandId && !items.length ? <div className="empty">No Gate 0 REVIEW/BLOCK assets in this brand.</div> : null}</section></>;
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
  const tabs = useMemo(() => ['LIBRARY','CREATE AVATAR','PASSPORT LAB','BODY + EXPRESSIONS LAB','GATE 0 REVIEW','TEST CONTENT'], []);
  return <main><header className="page-header"><span className="eyebrow">PERSISTENT PERSONAS · LEVELS 0–7</span><h1>Avatar Studio</h1></header><p className="page-note">Identity, consent, references and level approvals remain brand-scoped, versioned and plan-only until a separate production preflight.</p><ErrorPanel error={error} /><div className="avatar-tabs">{tabs.map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>{tab === 'LIBRARY' ? <AvatarLibrary brands={brands} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} revision={revision} /> : null}{tab === 'CREATE AVATAR' ? <CreateAvatar brands={brands} onCreated={() => setRevision((value) => value + 1)} /> : null}{tab === 'PASSPORT LAB' ? <PassportLab brands={brands} /> : null}{tab === 'BODY + EXPRESSIONS LAB' ? <BodyExpressionsLab brands={brands} /> : null}{tab === 'GATE 0 REVIEW' ? <Gate0ReviewQueue brands={brands} /> : null}{tab === 'TEST CONTENT' ? <TestContent brands={brands} /> : null}</main>;
}

export { AvatarDetail, AvatarLibrary, CreateAvatar, Gate0ReviewQueue, LevelLadder, LevelUpWorkflow, TestContent };
