'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { ControlRepository } = require('../apps/dashboard/server/control-repository');

const W1='21400000-0000-4000-8000-000000000001',W2='21400000-0000-4000-8000-000000000002';
const B1='21400000-0000-4000-8000-000000000011',B2='21400000-0000-4000-8000-000000000012';
const P1='067bd316-ee7c-42c8-bea3-ae61f72847b1',J1='bb4aff78-a7f8-4b8b-9405-b3957644104e';
const J2='21400000-0000-4000-8000-000000000032',R1='21400000-0000-4000-8000-000000000041';
const R2='21400000-0000-4000-8000-000000000042';
function databaseName(){return process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).pathname.replace(/^\//,''):process.env.PGDATABASE||'content_os';}
function safe(){if(process.env.CONTENT_FACTORY_TEST_DATABASE!=='1'||databaseName()==='content_os')throw new Error('V2.10.4 PostgreSQL test requires an explicitly disposable database');}
const db=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',database:process.env.PGDATABASE});
async function apply(file){await db.query(await fs.readFile(path.resolve(file),'utf8'));}
async function insertCreative({id=R1,requestId=R1,workspaceId=W1,brandId=B1,source='video-1',replacement='video-1-v2',reason='CREATIVE_PLAN_MISMATCH'}={}){
  return db.query(`INSERT INTO v2_7.shot_regenerations(id,workspace_id,brand_id,production_id,request_id,shot_id,
    source_asset_id,replacement_asset_id,revision_no,status,input_fingerprint,canonical_raw_input,
    provider,model,resolution,recovery_kind,retry_reason,supersedes_asset_id,automatic_attempt)
    VALUES($1,$2,$3,$4,$5,'shot-1',$6,$7,1,'RUNNING','fp','{}'::jsonb,
      'replicate','alibaba/wan-3','720p','SOURCE_CREATIVE',$8,$6,1) RETURNING *`,
  [id,workspaceId,brandId,P1,requestId,source,replacement,reason]);
}

async function main(){
  safe();
  try{
    await db.query('DROP SCHEMA IF EXISTS v2_7 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL);
      CREATE SCHEMA v2_2;CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL);
      CREATE SCHEMA v2_1;CREATE TABLE v2_1.productions(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id));
      CREATE TABLE v2_1.jobs(id uuid PRIMARY KEY,production_id uuid NOT NULL REFERENCES v2_1.productions(id),status text NOT NULL,
        worker_id text,lease_expires_at timestamptz,next_attempt_at timestamptz,error jsonb NOT NULL DEFAULT '{}',payload jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now());`);
    await db.query("INSERT INTO workspaces VALUES($1,'one'),($2,'two')",[W1,W2]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'one'),($3,$4,'two')",[B1,W1,B2,W2]);
    await db.query('INSERT INTO v2_1.productions VALUES($1,$2,$3)',[P1,W1,B1]);
    await db.query("INSERT INTO v2_1.jobs(id,production_id,status,error) VALUES($1,$3,'FAILED',$4),($2,$3,'FAILED',$4)",
      [J1,J2,P1,{code:'SOURCE_QUALITY_VALIDATION_FAILED'}]);
    await apply('migrations/20260824_v2_7_1_shot_regenerations.sql');
    await apply('migrations/20260830_v2_10_2_reference_geometry_recovery.sql');
    await apply('migrations/20260831_v2_10_4_source_creative_recovery.sql');
    await apply('migrations/20260831_v2_10_4_source_creative_recovery.sql');

    await insertCreative();
    await assert.rejects(()=>insertCreative({id:R2,requestId:R2,replacement:'video-1-v3'}),/duplicate key/,
      'database permits at most one automatic creative attempt per source asset');
    await assert.rejects(()=>insertCreative({id:R2,requestId:R2,source:'video-2',replacement:'video-2-v2',reason:'SUBJECT_MISMATCH'}),/check constraint/,
      'SOURCE_CREATIVE is restricted to the proven CREATIVE_PLAN_MISMATCH contract');
    await assert.rejects(()=>db.query("UPDATE v2_7.shot_regenerations SET retry_reason='changed' WHERE id=$1",[R1]),/identity is immutable/);
    await assert.rejects(()=>insertCreative({id:R2,requestId:R2,workspaceId:W2,brandId:B2,source:'video-2',replacement:'video-2-v2'}),/ownership mismatch/);

    const repository=new ControlRepository({db});
    assert.equal(await repository.countCreativeRecoveries(P1,'video-1',B1),1);
    assert.equal(await repository.countCreativeRecoveries(P1,'video-1',B2),0,'brand-scoped recovery lookup cannot leak across tenants');
    await repository.completeSourceRecovery(R1,{productionId:P1,jobId:J1,recoveryKind:'SOURCE_CREATIVE',
      result:{status:'SUCCEEDED',recoveryKind:'SOURCE_CREATIVE',sourceAssetId:'video-1',replacementAssetId:'video-1-v2'}});
    const jobs=await db.query('SELECT id,status,payload FROM v2_1.jobs ORDER BY id');
    const resumed=jobs.rows.find((row)=>row.id===J1);
    assert.equal(resumed.status,'RETRYING','the exact failed job resumes');
    assert.equal(resumed.payload.sourceRecovery.recoveryKind,'SOURCE_CREATIVE');
    assert.equal(jobs.rows.find((row)=>row.id===J2).status,'FAILED','unrelated failed job remains untouched');
    const lineage=await db.query('SELECT status,recovery_kind,retry_reason,supersedes_asset_id,automatic_attempt,result FROM v2_7.shot_regenerations WHERE id=$1',[R1]);
    assert.deepEqual({status:lineage.rows[0].status,recoveryKind:lineage.rows[0].recovery_kind,retryReason:lineage.rows[0].retry_reason,
      supersedes:lineage.rows[0].supersedes_asset_id,attempt:lineage.rows[0].automatic_attempt},
    {status:'SUCCEEDED',recoveryKind:'SOURCE_CREATIVE',retryReason:'CREATIVE_PLAN_MISMATCH',supersedes:'video-1',attempt:1});
    console.log('V2.10.4 PostgreSQL ownership, immutable creative lineage, one-attempt bound, and exact-job continuation passed; real external calls = 0');
  }finally{await db.query('DROP SCHEMA IF EXISTS v2_7 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE').catch(()=>{});await db.end();}
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
