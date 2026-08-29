'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const W1 = '21000000-0000-4000-8000-000000000001';
const W2 = '21000000-0000-4000-8000-000000000002';
const B1 = '21000000-0000-4000-8000-000000000011';
const B2 = '21000000-0000-4000-8000-000000000012';
function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os'; }
function safe() { if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') throw new Error('V2.10 PostgreSQL tests require CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database'); }
const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : { host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',database:process.env.PGDATABASE });

async function main() {
  safe();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL); CREATE SCHEMA v2_1; CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id))');
    await db.query("INSERT INTO workspaces VALUES($1,'one'),($2,'two')",[W1,W2]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'one'),($3,$4,'two')",[B1,W1,B2,W2]);
    const sql = await fs.readFile(path.resolve('migrations/20260829_v2_10_creative_production.sql'),'utf8'); await db.query(sql); await db.query(sql);
    const draft = (await db.query(`INSERT INTO v2_10.creative_drafts(workspace_id,brand_id,creative_schema_version,status,creative_brief,created_by)
      VALUES($1,$2,'2.10','DRAFT',$3,'operator') RETURNING *`,[W1,B1,{title:'draft'}])).rows[0];
    await assert.rejects(()=>db.query(`INSERT INTO v2_10.creative_drafts(workspace_id,brand_id,creative_schema_version,status,creative_brief,created_by)
      VALUES($1,$2,'2.10','DRAFT','{}','operator')`,[W1,B2]),/ownership mismatch/);
    await db.query("UPDATE v2_10.creative_drafts SET final_preflight=$2,preflight_fingerprint='abc',status='PREFLIGHT_READY' WHERE id=$1",[draft.id,{fingerprint:'abc'}]);
    const edited=(await db.query("UPDATE v2_10.creative_drafts SET creative_brief=$2 WHERE id=$1 RETURNING *",[draft.id,{title:'edited'}])).rows[0];
    assert.equal(edited.preflight_fingerprint,null,'editing clears stale preflight fingerprint'); assert.equal(edited.final_preflight,null); assert.equal(edited.revision,2);
    const previewValues=[W1,B1,'preview-fingerprint','mock','mock-tts','calm',{voice:'calm'},'text-hash','key','content-hash','audio/wav',4,1,{mocked:true}];
    await db.query(`INSERT INTO v2_10.voice_preview_artifacts(workspace_id,brand_id,preview_fingerprint,provider,model,voice_id,configuration,preview_text_hash,storage_key,content_hash,content_type,duration_seconds,external_call_count,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,previewValues);
    await assert.rejects(()=>db.query(`INSERT INTO v2_10.voice_preview_artifacts(workspace_id,brand_id,preview_fingerprint,provider,model,voice_id,configuration,preview_text_hash,storage_key,content_hash,content_type,duration_seconds,external_call_count,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,previewValues),/duplicate key/);
    await assert.rejects(()=>db.query("UPDATE v2_10.voice_preview_artifacts SET storage_key='changed' WHERE preview_fingerprint='preview-fingerprint'"),/immutable/);
    await assert.rejects(()=>db.query("DELETE FROM v2_10.voice_preview_artifacts WHERE preview_fingerprint='preview-fingerprint'"),/immutable/);
    await db.query(`INSERT INTO v2_10.uploaded_voice_artifacts(workspace_id,brand_id,version,storage_key,content_hash,content_type,size_bytes,duration_seconds,audio_metadata,operator_attestation,provenance)
      VALUES($1,$2,1,'voice/key','upload-hash','audio/wav',1024,8,$3,$4,$5)`,[W1,B1,{sampleRate:48000,channels:1},{confirmed:true,actor:'operator'},{externalCalls:0}]);
    await assert.rejects(()=>db.query("UPDATE v2_10.uploaded_voice_artifacts SET storage_key='changed' WHERE content_hash='upload-hash'"),/immutable/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_10.voice_preview_artifacts WHERE workspace_id=$1 AND brand_id=$2',[W2,B2])).rows[0].count,0,'brand/workspace isolation');
    await db.query("UPDATE v2_10.creative_drafts SET final_preflight=$2,preflight_fingerprint='final-fp',status='PREFLIGHT_READY' WHERE id=$1",[draft.id,{fingerprint:'final-fp'}]);
    const claimed=(await db.query("UPDATE v2_10.creative_drafts SET status='STARTING',start_claimed_at=now() WHERE id=$1 AND status='PREFLIGHT_READY' AND preflight_fingerprint='final-fp' RETURNING *",[draft.id])).rows[0];
    assert.equal(claimed.status,'STARTING'); assert.equal((await db.query("UPDATE v2_10.creative_drafts SET status='STARTING',start_claimed_at=now() WHERE id=$1 AND status='PREFLIGHT_READY' RETURNING *",[draft.id])).rowCount,0,'start claim is single-winner');
    const production=(await db.query('INSERT INTO v2_1.productions(workspace_id,brand_id) VALUES($1,$2) RETURNING id',[W1,B1])).rows[0];
    await db.query("UPDATE v2_10.creative_drafts SET status='STARTED',production_id=$2,started_at=now() WHERE id=$1",[draft.id,production.id]);
    await assert.rejects(()=>db.query("UPDATE v2_10.creative_drafts SET creative_brief='{}' WHERE id=$1",[draft.id]),/immutable/);
    await assert.rejects(()=>db.query('DELETE FROM v2_10.creative_drafts WHERE id=$1',[draft.id]),/cannot be deleted/);
    console.log('V2.10 PostgreSQL ownership, isolation, immutable voice evidence, preview idempotency, and stale-preflight invalidation passed.');
  } finally { await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(()=>{}); await db.end(); }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
