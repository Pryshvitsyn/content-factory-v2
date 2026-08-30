'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { ControlRepository } = require('../apps/dashboard/server/control-repository');

const W1='21000000-0000-4000-8000-000000000001',W2='21000000-0000-4000-8000-000000000002';
const B1='21000000-0000-4000-8000-000000000011',B2='21000000-0000-4000-8000-000000000012';
const P1='21000000-0000-4000-8000-000000000021',J1='21000000-0000-4000-8000-000000000031';
const J2='21000000-0000-4000-8000-000000000032',R1='21000000-0000-4000-8000-000000000041';
const R2='21000000-0000-4000-8000-000000000042';
function databaseName(){return process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).pathname.replace(/^\//,''):process.env.PGDATABASE||'content_os';}
function safe(){if(process.env.CONTENT_FACTORY_TEST_DATABASE!=='1'||databaseName()==='content_os')throw new Error('V2.10.2 PostgreSQL test requires an explicitly disposable database');}
const db=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',database:process.env.PGDATABASE});
async function apply(file){const sql=await fs.readFile(path.resolve(file),'utf8');await db.query(sql);}
async function insertRecovery({id=R1,requestId=R1,workspaceId=W1,brandId=B1,source='shot-2',replacement='shot-2-v2'}={}){
  return db.query(`INSERT INTO v2_7.shot_regenerations(id,workspace_id,brand_id,production_id,request_id,shot_id,
    source_asset_id,replacement_asset_id,revision_no,status,input_fingerprint,canonical_raw_input,
    provider,model,resolution,recovery_kind,retry_reason,supersedes_asset_id,automatic_attempt)
    VALUES($1,$2,$3,$4,$5,'shot-2',$6,$7,1,'RUNNING','fp','{}'::jsonb,
      'replicate','alibaba/wan-3','720p','SOURCE_GEOMETRY','WRONG_ORIENTATION',$6,1) RETURNING *`,
  [id,workspaceId,brandId,P1,requestId,source,replacement]);
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
    await apply('migrations/20260830_v2_10_2_reference_geometry_recovery.sql');

    await insertRecovery();
    await assert.rejects(()=>insertRecovery({id:R2,requestId:R2,replacement:'shot-2-v3'}),/duplicate key/,
      'database permits at most one automatic geometry attempt per source asset');
    await assert.rejects(()=>db.query("UPDATE v2_7.shot_regenerations SET retry_reason='changed' WHERE id=$1",[R1]),/identity is immutable/);
    await assert.rejects(()=>insertRecovery({id:R2,requestId:R2,workspaceId:W2,brandId:B2,source:'other',replacement:'other-v2'}),/ownership mismatch/);

    const repository=new ControlRepository({db});
    assert.equal(await repository.countGeometryRecoveries(P1,'shot-2',B1),1);
    assert.equal(await repository.countGeometryRecoveries(P1,'shot-2',B2),0,'brand-scoped recovery lookup cannot leak across tenants');
    await repository.completeGeometryRecovery(R1,{productionId:P1,jobId:J1,result:{status:'SUCCEEDED',sourceAssetId:'shot-2',replacementAssetId:'shot-2-v2'}});
    const jobs=await db.query('SELECT id,status,payload FROM v2_1.jobs ORDER BY id');
    assert.equal(jobs.rows.find((row)=>row.id===J1).status,'RETRYING','the exact failed job resumes');
    assert.equal(jobs.rows.find((row)=>row.id===J2).status,'FAILED','unrelated failed job remains untouched');
    const lineage=await db.query('SELECT status,recovery_kind,retry_reason,supersedes_asset_id,automatic_attempt,result FROM v2_7.shot_regenerations WHERE id=$1',[R1]);
    assert.deepEqual({status:lineage.rows[0].status,recoveryKind:lineage.rows[0].recovery_kind,retryReason:lineage.rows[0].retry_reason,
      supersedes:lineage.rows[0].supersedes_asset_id,attempt:lineage.rows[0].automatic_attempt},
    {status:'SUCCEEDED',recoveryKind:'SOURCE_GEOMETRY',retryReason:'WRONG_ORIENTATION',supersedes:'shot-2',attempt:1});
    console.log('V2.10.2 PostgreSQL ownership, immutable lineage, one-attempt bound, and exact-job continuation passed; real external calls = 0');
  }finally{await db.query('DROP SCHEMA IF EXISTS v2_7 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE').catch(()=>{});await db.end();}
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
