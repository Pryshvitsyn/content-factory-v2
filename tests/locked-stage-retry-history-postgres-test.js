'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { HardenedQualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-repository');

const W1 = '51000000-0000-4000-8000-000000000001';
const B1 = '51000000-0000-4000-8000-000000000011';

function databaseName() {
  return process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')
    : process.env.PGDATABASE || 'content_os';
}

function safe() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    throw new Error('Locked-stage retry history PostgreSQL test requires a disposable database');
  }
}

const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE,
});

async function apply(file) {
  const sql = await fs.readFile(path.resolve(file), 'utf8');
  await db.query(sql);
  await db.query(sql);
}

async function main() {
  safe();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL); CREATE SCHEMA v2_1; CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id))');
    await db.query("INSERT INTO workspaces VALUES($1,'one')", [W1]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'one')", [B1, W1]);

    await apply('migrations/20260829_v2_10_creative_production.sql');
    await apply('migrations/20260829_v2_10_completion.sql');
    await apply('migrations/20260901_locked_keyframe_production.sql');
    await apply('migrations/20260903_quality_script_first.sql');
    await apply('migrations/20260903_locked_stage_retry_history.sql');

    const obsoleteUnique = await db.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='v2_10.locked_stage_attempts'::regclass AND contype='u'
        AND pg_get_constraintdef(oid) ILIKE '%workflow_id%stage%preflight_id%'`);
    assert.equal(obsoleteUnique.rowCount, 0, 'one-attempt-ever uniqueness must be removed');

    const terminalTrigger = await db.query(`SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='v2_10' AND p.proname='protect_locked_stage_attempt'`);
    assert.match(terminalTrigger.rows[0].def, /terminal locked-keyframe stage attempt evidence is immutable/);

    const repository = new HardenedQualityScriptFirstPostgresRepository({ db });
    const draft = await repository.createDraft({
      workspaceId: W1,
      brandId: B1,
      brief: { title: 'retry-history' },
      validation: { status: 'PASS' },
      actor: 'operator',
    });
    const workflow = await repository.ensureLockedWorkflow({
      draftId: draft.id,
      workspaceId: W1,
      brandId: B1,
      shotId: 'shot-1',
      assetId: 'video-1',
      canonicalIntentFingerprint: 'intent-retry-history',
      actor: 'operator',
    });

    const preflight = await repository.saveLockedStagePreflight({
      workflowId: workflow.id,
      workspaceId: W1,
      brandId: B1,
      stage: 'KEYFRAME',
      draftRevision: draft.revision,
      plan: { fingerprint: 'keyframe-retry-fp', externalCalls: { maximum: 1 } },
      actor: 'operator',
    });

    const first = await repository.claimLockedStage({
      workflowId: workflow.id, workspaceId: W1, brandId: B1, stage: 'KEYFRAME', preflightId: preflight.id,
    });
    await repository.finishLockedStage({
      attemptId: first.id,
      status: 'FAILED',
      boundaryState: 'NOT_CROSSED',
      error: { code: 'KEYFRAME_GEOMETRY_MISMATCH', message: 'synthetic local geometry failure' },
    });

    const terminalBeforeRetry = (await db.query('SELECT * FROM v2_10.locked_stage_attempts WHERE id=$1', [first.id])).rows[0];
    assert.equal(terminalBeforeRetry.status, 'FAILED');
    assert.equal(terminalBeforeRetry.boundary_state, 'NOT_CROSSED');
    await assert.rejects(
      () => db.query("UPDATE v2_10.locked_stage_attempts SET error='{}'::jsonb WHERE id=$1", [first.id]),
      /terminal locked-keyframe stage attempt evidence is immutable/,
    );

    const second = await repository.claimLockedStage({
      workflowId: workflow.id, workspaceId: W1, brandId: B1, stage: 'KEYFRAME', preflightId: preflight.id,
    });
    assert.notEqual(second.id, first.id, 'safe retry must append a new attempt row');
    assert.equal(second.safeLocalRetry, true);
    assert.equal(second.retryOfAttemptId, first.id);

    const history = await db.query(`SELECT id,status,boundary_state,error FROM v2_10.locked_stage_attempts
      WHERE workflow_id=$1 AND stage='KEYFRAME' AND preflight_id=$2 ORDER BY started_at,id`,
    [workflow.id, preflight.id]);
    assert.equal(history.rowCount, 2);
    assert.equal(history.rows.find((row) => row.id === first.id).status, 'FAILED', 'old evidence remains terminal and unchanged');
    assert.equal(history.rows.find((row) => row.id === second.id).status, 'RUNNING');

    await repository.finishLockedStage({
      attemptId: second.id,
      status: 'FAILED',
      boundaryState: 'NOT_CROSSED',
      error: { code: 'SEMANTIC_VISUAL_PROVIDER_ERROR', message: 'synthetic unsafe failure' },
    });
    await assert.rejects(
      () => repository.claimLockedStage({
        workflowId: workflow.id, workspaceId: W1, brandId: B1, stage: 'KEYFRAME', preflightId: preflight.id,
      }),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED',
      'unknown/provider-related failures must remain fenced',
    );

    const ambiguousPreflight = await repository.saveLockedStagePreflight({
      workflowId: workflow.id,
      workspaceId: W1,
      brandId: B1,
      stage: 'KEYFRAME',
      draftRevision: draft.revision,
      plan: { fingerprint: 'keyframe-ambiguous-fp', externalCalls: { maximum: 1 } },
      actor: 'operator',
    });
    const ambiguous = await repository.claimLockedStage({
      workflowId: workflow.id, workspaceId: W1, brandId: B1, stage: 'KEYFRAME', preflightId: ambiguousPreflight.id,
    });
    await repository.markLockedStageBoundary({ attemptId: ambiguous.id });
    await repository.finishLockedStage({
      attemptId: ambiguous.id,
      status: 'NEEDS_RECONCILIATION',
      boundaryState: 'MAY_HAVE_STARTED',
      error: { code: 'SYNTHETIC_NETWORK_UNKNOWN' },
    });
    await assert.rejects(
      () => repository.claimLockedStage({
        workflowId: workflow.id, workspaceId: W1, brandId: B1, stage: 'KEYFRAME', preflightId: ambiguousPreflight.id,
      }),
      (error) => error.code === 'LOCKED_STAGE_ALREADY_ATTEMPTED',
      'ambiguous provider-boundary history must never auto-retry',
    );

    console.log('Locked-stage append-only retry history, terminal immutability and ambiguous-boundary fencing: PASS');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(() => {});
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
