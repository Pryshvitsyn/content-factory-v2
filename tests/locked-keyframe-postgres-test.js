'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { V210PostgresRepository } = require('../src/v2.10/postgres-repository');

const W1 = '31000000-0000-4000-8000-000000000001';
const W2 = '31000000-0000-4000-8000-000000000002';
const B1 = '31000000-0000-4000-8000-000000000011';
const B2 = '31000000-0000-4000-8000-000000000012';
function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os'; }
function safe() { if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') throw new Error('Locked-keyframe PostgreSQL tests require a disposable database'); }
const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async exists({ key }) { return this.values.has(key); }
  async put({ key, bytes }) { this.values.set(key, Buffer.from(bytes)); return { key, size: bytes.length }; }
}

async function apply(file) { const sql = await fs.readFile(path.resolve(file), 'utf8'); await db.query(sql); await db.query(sql); }

async function main() {
  safe();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL); CREATE SCHEMA v2_1; CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id))');
    await db.query("INSERT INTO workspaces VALUES($1,'one'),($2,'two')", [W1, W2]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'one'),($3,$4,'two')", [B1, W1, B2, W2]);
    await apply('migrations/20260829_v2_10_creative_production.sql');
    await apply('migrations/20260829_v2_10_completion.sql');
    await apply('migrations/20260901_locked_keyframe_production.sql');
    const index = await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname='v2_10' AND indexname='locked_stage_one_active_attempt'");
    assert.match(index.rows[0].indexdef, /WHERE.*status.*RUNNING.*NEEDS_RECONCILIATION/i);

    const repository = new V210PostgresRepository({ db, storage: new MemoryStorage() });
    const draft = await repository.createDraft({ workspaceId: W1, brandId: B1, brief: { title: 'synthetic' },
      validation: { status: 'PASS' }, actor: 'operator' });
    const workflow = await repository.ensureLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      shotId: 'shot-1', assetId: 'video-1', canonicalIntentFingerprint: 'intent-fp', actor: 'operator' });
    assert.equal(workflow.state, 'PREPARED');
    assert.equal((await repository.ensureLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      shotId: 'shot-1', assetId: 'video-1', canonicalIntentFingerprint: 'intent-fp', actor: 'operator' })).id, workflow.id);
    await assert.rejects(() => repository.ensureLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      shotId: 'shot-1', assetId: 'different', canonicalIntentFingerprint: 'intent-fp', actor: 'operator' }),
    (error) => error.code === 'LOCKED_WORKFLOW_CONFLICT');

    const firstBytes = Buffer.from('immutable-image-v1');
    const secondBytes = Buffer.from('immutable-image-v2');
    const first = await repository.storeKeyframeArtifact({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      productionId: workflow.production_id, shotId: 'shot-1', assetId: 'video-1', sourceType: 'OPERATOR_UPLOAD',
      provider: 'operator-upload', model: 'uploaded-image', generationSettings: {}, promptFingerprint: 'prompt-fp',
      bytes: firstBytes, contentHash: crypto.createHash('sha256').update(firstBytes).digest('hex'), contentType: 'image/png', width: 1080, height: 1920,
      provenance: { externalCalls: 0 }, actor: 'operator' });
    const second = await repository.storeKeyframeArtifact({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      productionId: workflow.production_id, shotId: 'shot-1', assetId: 'video-1', sourceType: 'AI_GENERATED',
      provider: 'mock-image', model: 'mock-v1', generationSettings: { seed: 2 }, promptFingerprint: 'prompt-fp-2',
      bytes: secondBytes, contentHash: crypto.createHash('sha256').update(secondBytes).digest('hex'), contentType: 'image/png', width: 1080, height: 1920,
      providerRequestId: 'request-2', provenance: { externalCalls: 1 }, actor: 'operator' });
    assert.equal(first.version, 1); assert.equal(second.version, 2); assert.equal(second.predecessor_id, first.id);
    await assert.rejects(() => db.query("UPDATE v2_10.keyframe_artifacts SET storage_key='changed' WHERE id=$1", [first.id]), /immutable/);
    await assert.rejects(() => repository.approveKeyframe({ keyframeId: second.id, workspaceId: W1, brandId: B1, actor: 'operator' }),
      (error) => error.code === 'KEYFRAME_VALIDATION_REQUIRED');

    const validation = await repository.recordKeyframeValidation({ keyframeId: second.id, workspaceId: W1, brandId: B1,
      shotPlanFingerprint: 'shot-plan-fp', result: { status: 'PASS', checks: [], metadata: { untrustedExternalData: true } },
      semanticExternalCalls: 1, evaluatorProvider: 'mock', evaluatorModel: 'mock-still' });
    const approved = await repository.approveKeyframe({ keyframeId: second.id, workspaceId: W1, brandId: B1, actor: 'operator' });
    assert.equal(approved.validation_event_id, validation.id); assert.equal(approved.approval_decision, 'APPROVED');
    assert.equal((await repository.approveKeyframe({ keyframeId: second.id, workspaceId: W1, brandId: B1,
      actor: 'operator' })).approval_event_id, approved.approval_event_id, 'approval is idempotent for the exact version');
    await repository.savePreflight({ id: draft.id, workspaceId: W1, brandId: B1,
      preflight: { status: 'READY', fingerprint: 'full-before-first-video' }, preflightRequest: {}, actor: 'operator' });
    await repository.recordFirstVideoResult({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      accepted: true, result: { externalCalls: { video: 1, semantic: 1 } } });
    const invalidatedDraft = await repository.getDraft({ id: draft.id, workspaceId: W1, brandId: B1 });
    assert.equal(invalidatedDraft.status, 'DRAFT'); assert.equal(invalidatedDraft.final_preflight, null,
      'accepted first video invalidates full preflight so remaining-only calls are recomputed');
    await assert.rejects(() => db.query("UPDATE v2_10.locked_keyframe_workflows SET state='PREPARED' WHERE id=$1", [workflow.id]),
      /invalid locked-keyframe workflow state transition/);
    await assert.rejects(() => db.query("UPDATE v2_10.keyframe_approval_events SET actor='other' WHERE keyframe_id=$1", [second.id]), /immutable/);
    assert.equal(await repository.getKeyframe({ id: second.id, workspaceId: W2, brandId: B2 }), null, 'brand/workspace isolation');

    const plan = { fingerprint: 'stage-fp', externalCalls: { maximum: 2 } };
    const stage = await repository.saveLockedStagePreflight({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', draftRevision: 1, keyframe: second, plan, actor: 'operator' });
    const attempt = await repository.claimLockedStage({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', preflightId: stage.id });
    await assert.rejects(() => repository.claimLockedStage({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', preflightId: stage.id }), (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED');
    await repository.markLockedStageBoundary({ attemptId: attempt.id });
    await repository.finishLockedStage({ attemptId: attempt.id, status: 'NEEDS_RECONCILIATION',
      boundaryState: 'MAY_HAVE_STARTED', error: { code: 'SYNTHETIC_NETWORK_UNKNOWN' } });
    await assert.rejects(() => db.query("UPDATE v2_10.locked_stage_attempts SET error='{}' WHERE id=$1", [attempt.id]),
      /terminal locked-keyframe stage attempt evidence is immutable/);
    const secondPreflight = await repository.saveLockedStagePreflight({ workflowId: workflow.id, workspaceId: W1,
      brandId: B1, stage: 'FIRST_VIDEO', draftRevision: 1, keyframe: second,
      plan: { fingerprint: 'stage-fp-2' }, actor: 'operator' });
    await assert.rejects(() => repository.claimLockedStage({ workflowId: workflow.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', preflightId: secondPreflight.id }), /duplicate key/);

    console.log('Locked-keyframe PostgreSQL immutability, lineage, approval, isolation, exact preflight and ambiguous-boundary fencing passed.');
  } finally { await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(() => {}); await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
