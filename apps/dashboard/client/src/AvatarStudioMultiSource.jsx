import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { AvatarLibrary, Gate0ReviewQueue, TestContent } from './AvatarStudio.jsx';
import { PassportLab } from './PassportLab';
import { BodyExpressionsLab } from './BodyExpressionsLab';
import { MotionPilot } from './MotionPilot';
import { CreateAvatarMultiSource } from './CreateAvatarMultiSource';
import { AvatarStudioV1Intake } from './AvatarStudioV1Intake';
import './AvatarStudio.css';

function ErrorPanel({ error }) { return error ? <div className="error-panel"><strong>{error.code}</strong><p>{error.message}</p></div> : null; }

export function AvatarStudio() {
  const [tab,setTab]=useState('LIBRARY'); const [brands,setBrands]=useState([]); const [selectedBrand,setSelectedBrand]=useState('');
  const [revision,setRevision]=useState(0); const [error,setError]=useState(null);
  useEffect(()=>{api('/api/brands').then(setBrands).catch(setError);},[]);
  const tabs=useMemo(()=>['LIBRARY','CREATE AVATAR','PASSPORT LAB','BODY + EXPRESSIONS LAB','AVATAR MOTION PILOT','GATE 0 REVIEW','TEST CONTENT'],[]);
  return <main><header className="page-header"><span className="eyebrow">PERSISTENT PERSONAS · LEVELS 0–7</span><h1>Avatar Studio</h1></header>
    <p className="page-note">Identity, consent, references and level approvals remain brand-scoped, versioned and plan-only until a separate production preflight.</p>
    <ErrorPanel error={error}/><div className="avatar-tabs">{tabs.map((item)=><button className={tab===item?'active':''} onClick={()=>setTab(item)} key={item}>{item}</button>)}</div>
    {tab==='LIBRARY'?<AvatarLibrary brands={brands} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} revision={revision}/>:null}
    {tab==='CREATE AVATAR'?<AvatarStudioV1Intake brands={brands} onCreated={()=>setRevision((value)=>value+1)}/>:null}
    {tab==='PASSPORT LAB'?<PassportLab brands={brands}/>:null}
    {tab==='BODY + EXPRESSIONS LAB'?<BodyExpressionsLab brands={brands}/>:null}
    {tab==='AVATAR MOTION PILOT'?<MotionPilot brands={brands}/>:null}
    {tab==='GATE 0 REVIEW'?<Gate0ReviewQueue brands={brands}/>:null}
    {tab==='TEST CONTENT'?<TestContent brands={brands}/>:null}
  </main>;
}
