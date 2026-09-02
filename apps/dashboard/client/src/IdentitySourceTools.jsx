import React, { useMemo, useState } from 'react';
import { api } from './api';
import './IdentitySourceTools.css';

export const IDENTITY_VIEWPOINTS = Object.freeze([
  'FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT','PROFILE_LEFT','PROFILE_RIGHT','OTHER','UNKNOWN',
]);

const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const VIDEO_TYPES = new Set(['video/mp4','video/webm','video/quicktime']);

function filePayload(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve({
      name:file.name, mimeType:file.type, contentBase64:String(reader.result).split(',')[1], capturedAt:new Date().toISOString(),
    });
    reader.readAsDataURL(file);
  });
}

function fileError(file, kind) {
  const type = String(file?.type || '').toLowerCase();
  if (kind === 'image' && !IMAGE_TYPES.has(type)) return { code:'FORMAT_UNSUPPORTED', message:`${file?.name || 'Image'} is not JPEG/JPG, PNG or WebP.` };
  if (kind === 'video' && !VIDEO_TYPES.has(type)) return { code:'FORMAT_UNSUPPORTED', message:`${file?.name || 'Video'} is not MP4, WebM or QuickTime/MOV.` };
  return null;
}

export function sourceViewpoint(source) {
  return source?.provenance?.identityViewpoint || source?.provenance?.viewpoint || 'UNKNOWN';
}

export function identityCoverage(sources = []) {
  const views = new Set(sources.filter((source) => source?.gate0Status === 'PASS' && source?.sourceType === 'IMAGE').map(sourceViewpoint));
  const frontal = views.has('FRONTAL');
  const threeQuarterLeft = views.has('THREE_QUARTER_LEFT');
  const threeQuarterRight = views.has('THREE_QUARTER_RIGHT');
  const profileLeft = views.has('PROFILE_LEFT');
  const profileRight = views.has('PROFILE_RIGHT');
  const threeQuarter = threeQuarterLeft || threeQuarterRight;
  const profile = profileLeft || profileRight;
  const score = [frontal,threeQuarter,profile].filter(Boolean).length;
  const state = score === 3 && (profileLeft && profileRight || threeQuarterLeft && threeQuarterRight) ? 'STRONG' : score >= 2 ? 'GOOD' : 'LIMITED';
  const recommendations = [];
  if (!frontal) recommendations.push('Add a frontal reference.');
  if (!threeQuarter) recommendations.push('Add a 45° / three-quarter reference.');
  if (!profile) recommendations.push('Add a true profile reference before profile certification.');
  else if (!(profileLeft && profileRight)) recommendations.push('Optional: add the opposite profile for stronger coverage.');
  return Object.freeze({ state, views:Object.freeze([...views]), frontal, threeQuarterLeft, threeQuarterRight, profileLeft, profileRight,
    threeQuarter, profile, recommendations:Object.freeze(recommendations) });
}

export function IdentityCoverage({ sources = [] }) {
  const coverage = useMemo(() => identityCoverage(sources), [sources]);
  const rows = [
    ['FRONTAL',coverage.frontal],['THREE_QUARTER_LEFT',coverage.threeQuarterLeft],['THREE_QUARTER_RIGHT',coverage.threeQuarterRight],
    ['PROFILE_LEFT',coverage.profileLeft],['PROFILE_RIGHT',coverage.profileRight],
  ];
  return <section className="identity-coverage" aria-label="Identity coverage">
    <header><strong>IDENTITY COVERAGE</strong><span className={`coverage-state coverage-${coverage.state.toLowerCase()}`}>{coverage.state}</span></header>
    <div className="coverage-grid">{rows.map(([name,present]) => <span key={name}>{name.replaceAll('_',' ')} <strong>{present ? '✓' : '—'}</strong></span>)}</div>
    {coverage.recommendations.length ? <div className="coverage-notes">{coverage.recommendations.map((text) => <p key={text}>{text}</p>)}</div> : <p>Source-view coverage is strong. Human identity comparison is still mandatory.</p>}
  </section>;
}

function waitFor(target, event) {
  return new Promise((resolve,reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Video ${event} failed`)); };
    const cleanup = () => { target.removeEventListener(event,done); target.removeEventListener('error',fail); };
    target.addEventListener(event,done,{ once:true }); target.addEventListener('error',fail,{ once:true });
  });
}

async function seek(video, time) {
  if (Math.abs(video.currentTime - time) < 0.01) return;
  video.currentTime = time;
  await waitFor(video,'seeked');
}

export async function extractReferenceFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata'; video.muted = true; video.playsInline = true; video.src = url;
  try {
    await waitFor(video,'loadedmetadata');
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Reference video has no usable duration');
    const width = Number(video.videoWidth); const height = Number(video.videoHeight);
    if (!width || !height) throw new Error('Reference video has no readable frame dimensions');
    const fractions = [0.15,0.5,0.85];
    const defaultViews = ['THREE_QUARTER_LEFT','FRONTAL','THREE_QUARTER_RIGHT'];
    const frames = [];
    for (let index=0; index<fractions.length; index += 1) {
      const timestamp = Math.min(Math.max(duration * fractions[index],0),Math.max(duration - 0.02,0));
      await seek(video,timestamp);
      const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas frame extraction is unavailable');
      context.drawImage(video,0,0,width,height);
      const blob = await new Promise((resolve,reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Frame encoding failed')),'image/png'));
      const base = String(file.name || 'reference-video').replace(/\.[^.]+$/,'');
      const frameFile = new File([blob],`${base}-frame-${index + 1}.png`,{ type:'image/png',lastModified:Date.now() });
      frames.push({ id:`frame-${index + 1}-${Date.now()}`, file:frameFile, timestampMs:Math.round(timestamp*1000),
        viewpoint:defaultViews[index], selected:true, previewUrl:URL.createObjectURL(blob) });
    }
    return frames;
  } finally { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); }
}

export function sourcePreviewUrl(source, brandId, avatarId) {
  if (!source?.intakeAssetId) return null;
  return `/api/avatar-studio/intakes/${encodeURIComponent(source.intakeAssetId)}/content?brandId=${encodeURIComponent(brandId)}&avatarId=${encodeURIComponent(avatarId)}`;
}

export function ExistingIdentitySourceManager({ avatar, brandId, onSourcesChanged }) {
  const [photos,setPhotos] = useState([]); const [videoFile,setVideoFile] = useState(null); const [videoIntake,setVideoIntake] = useState(null);
  const [frames,setFrames] = useState([]); const [busy,setBusy] = useState(false); const [error,setError] = useState(null); const [message,setMessage] = useState('');
  const owner = avatar?.subjectType === 'SYNTHETIC' ? 'SYNTHETIC' : 'CONSENTED_SUBJECT';

  function stagePhotos(fileList) {
    const files = [...(fileList || [])];
    const invalid = files.map((file) => fileError(file,'image')).find(Boolean);
    if (invalid) { setError(invalid); return; }
    if (files.length > 10) { setError({code:'SOURCE_SET_TOO_LARGE',message:'Choose at most 10 identity photographs per batch.'}); return; }
    setError(null); setPhotos(files.map((file,index) => ({ id:`photo-${Date.now()}-${index}`,file,viewpoint:'UNKNOWN' })));
  }

  async function createIntake(file, provenance) {
    return api(`/api/avatar-studio/avatars/${avatar.id}/intakes`,{ method:'POST',body:JSON.stringify({
      brandId,sourceType:'UPLOAD',file:await filePayload(file),provenance:{ owner,...provenance },
    }) });
  }

  async function attachIntake(intake, roles) {
    if (intake.asset.effectiveGate0Status !== 'PASS') throw { code:'IDENTITY_SOURCE_REVIEW_REQUIRED',
      message:`${intake.asset.originalFilename || 'Source'} is ${intake.asset.effectiveGate0Status}. Resolve it in Gate 0 Review; nothing was auto-approved.` };
    return api(`/api/avatar-studio/avatars/${avatar.id}/intakes/${intake.asset.id}/use`,{ method:'POST',body:JSON.stringify({ brandId,roles }) });
  }

  async function uploadPhotos() {
    if (!photos.length) return;
    setBusy(true); setError(null); setMessage('');
    try {
      for (const item of photos) {
        const intake = await createIntake(item.file,{ source:'PASSPORT_LAB_ADDITIONAL_IDENTITY_SOURCE',evidenceClass:'IDENTITY_SOURCE',identityViewpoint:item.viewpoint });
        await attachIntake(intake,['IDENTITY','PASSPORT_SOURCE']);
      }
      setPhotos([]); setMessage('Additional identity photographs attached to this same avatar. Provider calls: 0.');
      await onSourcesChanged?.();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  async function stageVideo(file) {
    const invalid = fileError(file,'video'); if (invalid) { setError(invalid); return; }
    setError(null); setMessage(''); setVideoFile(file); setFrames([]); setVideoIntake(null);
  }

  async function intakeVideoAndExtract() {
    if (!videoFile) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const intake = await createIntake(videoFile,{ source:'PASSPORT_LAB_REFERENCE_VIDEO',evidenceClass:'VISUAL_IDENTITY_VIDEO',visualOnly:true,
        audioPolicy:'IGNORED_NOT_VOICE_SOURCE',identityViewpoint:'OTHER' });
      await attachIntake(intake,['IDENTITY']);
      setVideoIntake(intake.asset);
      const extracted = await extractReferenceFrames(videoFile);
      setFrames(extracted); setMessage('Video stored as visual-only identity evidence. Three frames were extracted locally; audio was ignored. Provider calls: 0.');
      await onSourcesChanged?.();
    } catch (cause) { setError({ code:cause?.code || 'REFERENCE_VIDEO_FAILED',message:cause?.message || String(cause) }); } finally { setBusy(false); }
  }

  async function attachSelectedFrames() {
    const selected = frames.filter((frame) => frame.selected);
    if (!videoIntake || !selected.length) return;
    setBusy(true); setError(null); setMessage('');
    try {
      for (const frame of selected) {
        const intake = await createIntake(frame.file,{ source:'LOCAL_REFERENCE_VIDEO_FRAME',evidenceClass:'DERIVED_VIDEO_FRAME',visualOnly:true,
          derivedFromVideoIntakeId:videoIntake.id,derivedFromTimestampMs:frame.timestampMs,identityViewpoint:frame.viewpoint });
        await attachIntake(intake,['IDENTITY','PASSPORT_SOURCE']);
      }
      frames.forEach((frame) => frame.previewUrl && URL.revokeObjectURL(frame.previewUrl));
      setFrames([]); setVideoFile(null); setVideoIntake(null);
      setMessage('Selected video frames attached as separate immutable Passport sources. Provider calls: 0.');
      await onSourcesChanged?.();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  return <section className="identity-source-manager">
    <header><div><strong>ADD IDENTITY SOURCES</strong><p>Add evidence to {avatar.internalName}; this never creates another avatar, Identity version, or Identity Lock.</p></div><span>0 provider calls</span></header>
    {error ? <div className="error-panel"><strong>{error.code || 'SOURCE_INTAKE_FAILED'}</strong><p>{error.message}</p></div> : null}
    {message ? <p className="source-manager-message">{message}</p> : null}
    <div className="identity-source-actions">
      <label className="upload-button">ADD PHOTOS<input aria-label="Add identity photos" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => stagePhotos(event.target.files)} /></label>
      <label className="upload-button">ADD REFERENCE VIDEO<input aria-label="Add identity reference video" type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy} onChange={(event) => event.target.files?.[0] && stageVideo(event.target.files[0])} /></label>
    </div>
    {photos.length ? <div className="identity-source-grid">{photos.map((item) => <article key={item.id}><strong>{item.file.name}</strong><small>{Math.round(item.file.size/1024)} KB · exact source bytes</small><label>Viewpoint<select value={item.viewpoint} onChange={(event) => setPhotos((current) => current.map((entry) => entry.id===item.id ? {...entry,viewpoint:event.target.value}:entry))}>{IDENTITY_VIEWPOINTS.map((view) => <option key={view}>{view}</option>)}</select></label></article>)}<button className="primary" disabled={busy} onClick={uploadPhotos}>{busy?'ADDING…':'RUN GATE 0 & ATTACH PHOTOS'}</button></div> : null}
    {videoFile && !videoIntake ? <div className="reference-video-stage"><strong>{videoFile.name}</strong><p>Optional visual evidence only. Audio is ignored and never becomes VOICE_SOURCE.</p><button className="secondary" disabled={busy} onClick={intakeVideoAndExtract}>{busy?'PROCESSING…':'INTAKE VIDEO & EXTRACT LOCAL FRAMES'}</button></div> : null}
    {frames.length ? <div className="video-frame-grid">{frames.map((frame) => <article key={frame.id}><img src={frame.previewUrl} alt={`Reference frame ${frame.timestampMs}ms`} /><label><input type="checkbox" checked={frame.selected} onChange={() => setFrames((current) => current.map((entry) => entry.id===frame.id ? {...entry,selected:!entry.selected}:entry))} />Use frame · {(frame.timestampMs/1000).toFixed(1)}s</label><select aria-label="Video frame viewpoint" value={frame.viewpoint} onChange={(event) => setFrames((current) => current.map((entry) => entry.id===frame.id ? {...entry,viewpoint:event.target.value}:entry))}>{IDENTITY_VIEWPOINTS.map((view) => <option key={view}>{view}</option>)}</select></article>)}<button className="primary" disabled={busy || !frames.some((frame) => frame.selected)} onClick={attachSelectedFrames}>{busy?'ADDING…':'ATTACH SELECTED FRAMES'}</button></div> : null}
  </section>;
}
