'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');
const native=process.env.RECOVERY_TEST_NATIVE==='1';
const {PostgresMediaExecutionRepository:Repo}=require('../src/v2.5/durable-media-executor');
const {LEGACY_RESOLUTION_REJECTION:message}=require('../src/providers/execution-outcome');
const uu=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
async function main(){
 if(native && (process.env.CONTENT_FACTORY_TEST_DATABASE!=='1' || !String(process.env.PGDATABASE||'').endsWith('_test')))
  throw Error('Native recovery tests require an explicitly isolated *_test database');
 const pool=native?new (require('pg').Pool)({max:2}):null;
 const db=native?{query:(...args)=>pool.query(...args),exec:(sql)=>pool.query(sql),close:()=>pool.end()}
  :new (require(process.env.APPROVAL_PGLITE_MODULE||'@electric-sql/pglite').PGlite)();
 try{
 await db.exec(`CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE SCHEMA v2_1;CREATE SCHEMA v2_2;
 CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid);CREATE TABLE v2_1.productions(id uuid PRIMARY KEY,workspace_id uuid,brand_id uuid);
 CREATE SCHEMA v2_10;CREATE TABLE v2_10.locked_stage_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_id uuid,preflight_id uuid,stage text,status text,boundary_state text,provider_request_id text,result jsonb DEFAULT '{}',error jsonb DEFAULT '{}',workspace_id uuid,brand_id uuid,started_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX locked_stage_one_active_attempt ON v2_10.locked_stage_attempts(workflow_id,stage) WHERE status IN ('RUNNING','NEEDS_RECONCILIATION');
 CREATE TABLE v2_10.locked_keyframe_workflows(id uuid,draft_id uuid,workspace_id uuid,brand_id uuid,production_id uuid,state text);
 CREATE FUNCTION v2_10.immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable';END $$;
 CREATE TRIGGER protect_attempt BEFORE UPDATE OR DELETE ON v2_10.locked_stage_attempts FOR EACH ROW EXECUTE FUNCTION v2_10.immutable();`);
 await db.exec(fs.readFileSync('migrations/20260823_v2_5_durable_media_executions.sql','utf8'));
 const w=uu(1),b=uu(2),p=uu(3),wf=uu(4);
 await db.query('INSERT INTO workspaces VALUES($1)',[w]);await db.query('INSERT INTO v2_2.brands VALUES($1,$2)',[b,w]);
 await db.query('INSERT INTO v2_1.productions VALUES($1,$2,$3)',[p,w,b]);
 const repo=new Repo({db});const args={workspaceId:w,brandId:b,productionId:p,asset:{asset_id:'video-1',kind:'video'},fingerprint:'old',idempotencyKey:'old',provider:'replicate',model:'bytedance/seedance-2.5'};
 const old=(await db.query(`INSERT INTO v2_5.media_executions
 (workspace_id,brand_id,production_id,asset_id,kind,input_fingerprint,idempotency_key,provider,model)
 VALUES($1,$2,$3,'video-1','video','old','old','replicate','bytedance/seedance-2.5') RETURNING *`,[w,b,p])).rows[0];
 await db.query("UPDATE v2_5.media_executions SET status='NEEDS_RECONCILIATION',error=$2 WHERE id=$1",[old.id,{code:'REPLICATE_HTTP_ERROR',message:message+'\n'}]);
 await db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state,error) VALUES($1,'FIRST_VIDEO','NEEDS_RECONCILIATION','MAY_HAVE_STARTED',$2)",[wf,{code:'REPLICATE_HTTP_ERROR',message:message+'\n'}]);
 // Reproduce a real upgrade: several old ambiguous outcomes for one workflow.
 await db.exec('DROP INDEX v2_10.locked_stage_one_active_attempt');
 const other=uu(88);
 for(const code of ['REPLICATE_NETWORK_ERROR','REPLICATE_PREDICTION_FAILED','FIRST_VIDEO_STAGE_FAILED'])
  await db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state,error,workspace_id,brand_id) VALUES($1,'FIRST_VIDEO','NEEDS_RECONCILIATION','MAY_HAVE_STARTED',$2,$3,$4)",[other,{code,message:'historical unresolved outcome'},w,b]);
 const history=(await db.query('SELECT * FROM v2_10.locked_stage_attempts ORDER BY id')).rows;
 const sql=fs.readFileSync('migrations/20261102_provider_rejection_recovery.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('SELECT * FROM v2_10.locked_stage_attempts ORDER BY id')).rows,history);
 const correctedProduction=uu(33);
 await db.query('INSERT INTO v2_1.productions VALUES($1,$2,$3)',[correctedProduction,w,b]);
 const corrected={...args,productionId:correctedProduction,fingerprint:'corrected',idempotencyKey:'corrected'};
 const next=await repo.ensure(corrected);assert.notEqual(old.id,next.id);
 assert.equal((await repo.ensure(corrected)).id,next.id,'same corrected identity reuses the row');
 await repo.claim({id:next.id,workerId:'worker'});
 await repo.markFailure({id:next.id,workerId:'worker',boundaryCrossed:true,terminal:true,error:{code:'REPLICATE_HTTP_ERROR',message:'rejected',details:{providerExecutionOutcome:'REJECTED_BEFORE_CREATION'}}});
 assert.equal((await repo.get({...corrected,assetId:'video-1'})).status,'FAILED');
 assert.equal((await repo.get({...args,assetId:'video-1'})).id,old.id,'historical production is addressable');
 await assert.rejects(()=>repo.ensure({...args,workspaceId:uu(99),fingerprint:'foreign',idempotencyKey:'foreign'}));
 await db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state) VALUES($1,'FIRST_VIDEO','RUNNING','NOT_CROSSED')",[wf]);
 await assert.rejects(()=>db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state) VALUES($1,'FIRST_VIDEO','RUNNING','NOT_CROSSED')",[wf]),e=>e.code==='23505');
 await assert.rejects(()=>db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state) VALUES($1,'FIRST_VIDEO','RUNNING','NOT_CROSSED')",[other]),e=>e.code==='23505');
 await db.exec(sql); // A restart after a corrected RUNNING attempt must also succeed.
 assert.equal((await db.query('SELECT count(*)::int AS n FROM v2_10.locked_stage_attempts WHERE workflow_id=$1',[other])).rows[0].n,3);
 await assert.rejects(()=>db.exec('DELETE FROM v2_10.locked_stage_attempts'),/immutable/);
 assert.equal((await repo.get({...args,assetId:'video-1',fingerprint:'old'})).status,'NEEDS_RECONCILIATION','historical media refusal retained unchanged');
 const acceptedWorkflow=uu(55),draft=uu(56);
 await db.query("INSERT INTO v2_10.locked_keyframe_workflows VALUES($1,$2,$3,$4,$5,'FIRST_VIDEO_ACCEPTED')",[acceptedWorkflow,draft,w,b,p]);
 await db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state,workspace_id,brand_id,result) VALUES($1,'FIRST_VIDEO','SUCCEEDED','COMPLETED',$2,$3,$4)",[acceptedWorkflow,w,b,{accepted:true,productionId:correctedProduction}]);
 const {HardenedQualityScriptFirstPostgresRepository}=require('../src/v2.10/quality-script-first-repository');
 const workflowRepo=new HardenedQualityScriptFirstPostgresRepository({db});
 await assert.rejects(()=>workflowRepo.assertLockedStageAvailable({workflowId:other,workspaceId:w,brandId:b,stage:'FIRST_VIDEO'}),/reconciliation/);
 const startup=fs.readFileSync('scripts/prepare-local-live-production.js','utf8');
 assert(!startup.includes("'migrations/20260903_locked_stage_retry_history.sql'"),'startup must not rebuild the superseded active index');
 const race=await Promise.allSettled([1,2].map(()=>db.query("INSERT INTO v2_10.locked_stage_attempts(workflow_id,stage,status,boundary_state) VALUES($1,'FIRST_VIDEO','RUNNING','NOT_CROSSED')",[uu(77)])));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(race.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
 assert.equal(await workflowRepo.markLockedContinuationStarted({draftId:draft,workspaceId:w,brandId:b,productionId:p}),null,'frame-origin production cannot authorize continuation');
 assert.equal((await workflowRepo.markLockedContinuationStarted({draftId:draft,workspaceId:w,brandId:b,productionId:correctedProduction})).state,'CONTINUATION_STARTED');
 console.log('PASS PostgreSQL/PGlite: migration reruns, immutable history, separate canonical production, duplicate identity, cross-scope denial, active-stage uniqueness and unknown-outcome fencing.');
}finally{await db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
