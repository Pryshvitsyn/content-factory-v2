const assert=require('node:assert/strict');
const fs=require('node:fs');
const { PGlite }=require(process.env.APPROVAL_PGLITE_MODULE || '@electric-sql/pglite');
const {recordQualityApproval}=require('../src/v2.10/quality-approval-events');
const migration=fs.readFileSync(require('node:path').join(__dirname,'../migrations/20261101_quality_approval_lifecycle.sql'),'utf8');
const draft='00000000-0000-0000-0000-000000000001', workspace='00000000-0000-0000-0000-000000000002', brand='00000000-0000-0000-0000-000000000003', subject='00000000-0000-0000-0000-000000000004';
async function test(upgrade){
const db=new PGlite();
await db.exec(`CREATE SCHEMA v2_10;
CREATE TABLE v2_10.creative_drafts(id uuid PRIMARY KEY, workspace_id uuid NOT NULL,brand_id uuid NOT NULL);
CREATE TABLE v2_10.quality_stage_approval_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,workspace_id uuid NOT NULL,brand_id uuid NOT NULL,stage text NOT NULL,subject_type text NOT NULL,subject_id uuid NOT NULL,subject_fingerprint text NOT NULL,decision text NOT NULL,reason text,actor text NOT NULL,decided_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX quality_single_positive_approval ON v2_10.quality_stage_approval_events(draft_id,stage,subject_fingerprint) WHERE decision='APPROVED';
INSERT INTO v2_10.creative_drafts VALUES('${draft}','${workspace}','${brand}');
CREATE FUNCTION v2_10.protect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON v2_10.quality_stage_approval_events FOR EACH ROW EXECUTE FUNCTION v2_10.protect();`);
if(upgrade) await db.exec(`INSERT INTO v2_10.quality_stage_approval_events(draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,decision,actor,decided_at) VALUES
('${draft}','${workspace}','${brand}','STORYBOARD','STORYBOARD_REVISION','${subject}','fp','APPROVED','test','2026-01-01'),
('${draft}','${workspace}','${brand}','STORYBOARD','STORYBOARD_REVISION','${subject}','fp','INVALIDATED','test','2026-01-02');`);
const history=(await db.query('SELECT id,decision,decided_at FROM v2_10.quality_stage_approval_events ORDER BY decided_at')).rows;
await db.exec(migration);
let tail=Promise.resolve();
const pool={async connect(){const prev=tail;let release;tail=new Promise(r=>release=r);await prev;return {query:(s,p)=>db.query(s,p),release};}};
const args={draftId:draft,workspaceId:workspace,brandId:brand,stage:'STORYBOARD',subjectType:'STORYBOARD_REVISION',subjectId:subject,subjectFingerprint:'fp',decision:'APPROVED',actor:'test'};
const first=await recordQualityApproval(pool,args);
const repeated=await Promise.all(Array.from({length:5},()=>recordQualityApproval(pool,args)));
assert(repeated.every(e=>e.id===first.id));
await recordQualityApproval(pool,{...args,decision:'INVALIDATED'});
const second=await recordQualityApproval(pool,args);assert.notEqual(first.id,second.id);
assert(Number(second.approval_cycle)>Number(first.approval_cycle));
assert(new Date(second.decided_at)>=new Date(first.decided_at));
await assert.rejects(()=>db.exec(`INSERT INTO v2_10.quality_stage_approval_events(draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,decision,actor) VALUES('${draft}','${workspace}','${brand}','STORYBOARD','STORYBOARD_REVISION','${subject}','fp','APPROVED','direct')`),e=>e.code==='23505');
await assert.rejects(()=>recordQualityApproval(pool,{...args,brandId:subject}),e=>e.code==='DRAFT_NOT_FOUND');
await assert.rejects(()=>db.exec('DELETE FROM v2_10.quality_stage_approval_events'),/immutable/);
await assert.rejects(()=>db.exec("UPDATE v2_10.quality_stage_approval_events SET decision='APPROVED'"),/immutable/);
// Simulate legacy startup DDL BEFORE repeatable new migration, after duplicate historical approvals exist.
await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS quality_single_positive_approval ON v2_10.quality_stage_approval_events(draft_id,stage,subject_fingerprint) WHERE decision='APPROVED'");
await db.exec(migration); await db.exec(migration);
const saved=(await db.query('SELECT id,decision,decided_at FROM v2_10.quality_stage_approval_events ORDER BY decided_at')).rows;
assert.deepEqual(saved.slice(0,history.length),history);
assert.equal(saved.at(-1).decision,'APPROVED');
await db.close();console.log('PASS PostgreSQL/PGlite:',upgrade?'upgrade with immutable history':'clean fixture',', migration rerun, old startup DDL, duplicate constraint, scope, reapproval, immutability');
}
(async()=>{await test(false);await test(true)})().catch(e=>{console.error(e);process.exitCode=1});
