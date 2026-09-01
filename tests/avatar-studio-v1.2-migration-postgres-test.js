'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');

const WORKSPACE='b0000000-0000-4000-8000-000000000001';
const BRAND='b0000000-0000-4000-8000-000000000002';
const CHARACTER='b0000000-0000-4000-8000-000000000003';

function assertDisposable(){const name=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).pathname.slice(1):process.env.PGDATABASE;
  if(process.env.CONTENT_FACTORY_TEST_DATABASE!=='1'||!name||name==='content_os')throw new Error('Disposable PostgreSQL database required');}

async function main(){assertDisposable();const db=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{
  host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE});
  try{
    await db.query('DROP SCHEMA IF EXISTS avatar_studio CASCADE');
    await db.query(await fs.readFile(path.resolve('migrations/20260831_avatar_studio_v1.sql'),'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260831_avatar_studio_v1_1_asset_intake.sql'),'utf8'));
    await db.query(`INSERT INTO workspaces(id,name) VALUES($1,'V1.2 populated upgrade') ON CONFLICT(id) DO NOTHING`,[WORKSPACE]);
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status) VALUES($1,$2,'Upgrade Brand','upgrade-brand','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`,[BRAND,WORKSPACE]);
    await db.query(`INSERT INTO avatar_studio.brand_verticals(workspace_id,brand_id,vertical_code,assigned_by)
      VALUES($1,$2,'PSYCHOLOGY_WELLBEING','migration-test')`,[WORKSPACE,BRAND]);
    await db.query(`INSERT INTO avatar_studio.characters(id,workspace_id,vertical_code,internal_name,subject_type,created_by)
      VALUES($1,$2,'PSYCHOLOGY_WELLBEING','Populated Avatar','SYNTHETIC','migration-test')`,[CHARACTER,WORKSPACE]);
    await db.query(`INSERT INTO avatar_studio.character_versions(workspace_id,character_id,version,identity_spec,identity_hash,provenance,created_by)
      VALUES($1,$2,1,$3,'identity-hash','{"source":"migration-test"}','migration-test')`,[WORKSPACE,CHARACTER,{
      agePresentation:'adult',personality:'calm',role:'host',languages:['en'],visualDirection:'natural',permanentAttributes:{},prohibitedUses:['deception']}]);
    await db.query(`INSERT INTO avatar_studio.brand_permissions(workspace_id,character_id,brand_id,approved_by)
      VALUES($1,$2,$3,'migration-test')`,[WORKSPACE,CHARACTER,BRAND]);
    await db.query(`INSERT INTO avatar_studio.consent_records(workspace_id,character_id,scope,status,rights_basis,provenance,recorded_by)
      VALUES($1,$2,'SYNTHETIC_IDENTITY','APPROVED','SYNTHETIC_IDENTITY','{"source":"migration-test"}','migration-test')`,[WORKSPACE,CHARACTER]);
    await db.query(`INSERT INTO avatar_studio.level_states(workspace_id,character_id,current_level,level_name)
      VALUES($1,$2,0,'IDENTITY')`,[WORKSPACE,CHARACTER]);
    const before=Number((await db.query('SELECT count(*) AS count FROM avatar_studio.characters WHERE id=$1',[CHARACTER])).rows[0].count);
    await db.query(await fs.readFile(path.resolve('migrations/20260901_avatar_studio_v1_2_passport_lab.sql'),'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260901_avatar_studio_v1_2_passport_lab.sql'),'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260901_avatar_studio_v1_2_passport_lab_controlled_execution.sql'),'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260901_avatar_studio_v1_2_passport_lab_controlled_execution.sql'),'utf8'));
    const after=Number((await db.query('SELECT count(*) AS count FROM avatar_studio.characters WHERE id=$1',[CHARACTER])).rows[0].count);
    assert.equal(before,1);assert.equal(after,1,'populated V1.1 avatar must survive upgrade and reapplication');
    for(const table of ['identity_lock_versions','passport_generation_specs','passport_candidates','passport_qa_snapshots',
      'passport_candidate_review_events','passport_certification_events','passport_generation_executions','passport_execution_events',
      'passport_execution_approvals','passport_provider_attempts','passport_provider_attempt_events','passport_execution_results'])
      assert.equal((await db.query('SELECT to_regclass($1) AS name',[`avatar_studio.${table}`])).rows[0].name,`avatar_studio.${table}`);
    await assert.rejects(()=>db.query(`UPDATE avatar_studio.level_states SET current_level=1,level_name='PASSPORT' WHERE character_id=$1`,[CHARACTER]),
      (error)=>error.code==='P0001'&&error.message.includes('CERTIFIED_PASSPORT_REQUIRED'));
    assert.equal((await db.query('SELECT current_level FROM avatar_studio.level_states WHERE character_id=$1',[CHARACTER])).rows[0].current_level,0);
    console.log('Avatar Studio V1.2.1 populated upgrade + migration reapplication + immutable execution tables + database L0 guard passed');
  }finally{await db.end();}}
main().catch((error)=>{console.error(error);process.exitCode=1;});
