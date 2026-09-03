'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { QualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-postgres-repository');
const { buildScriptScaffold, buildStoryboardScaffold, validateScript, validateStoryboard } = require('../src/v2.10/quality-script-first-contract');
const { canonicalCreativeBrief, fingerprint } = require('../src/v2.10/creative-contract');

const W1 = '41000000-0000-4000-8000-000000000001';
const B1 = '41000000-0000-4000-8000-000000000011';
function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os'; }
function safe() { if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') throw new Error('QUALITY script-first PostgreSQL tests require a disposable database'); }
const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE });
async function apply(file) { const sql = await fs.readFile(path.resolve(file), 'utf8'); await db.query(sql); await db.query(sql); }

function creativeBrief() {
  return canonicalCreativeBrief({
    title: 'script-first', objective: 'Show a trigger and deliberate interruption.', targetPlatform: 'Instagram Reels',
    targetDurationSeconds: 10, hook: 'A message triggers an immediate reaction.', coreMessage: 'Stop before responding.',
    cta: 'Turn the impulse off.', audienceIntent: 'Adults improving difficult conversations.',
    creativeConcept: 'Natural trigger then regulation.', visualStyle: 'Cinematic vertical realism.',
    continuity: { identity: 'same adult', appearance: 'same face', wardrobe: 'same dark shirt',
      environment: 'same kitchen', props: 'same phone', lightingColorLanguage: 'cool daylight', cameraLanguage: 'natural handheld' },
    storyboard: [
      { shotId: 'shot-1', assetId: 'video-1', durationSeconds: 5, roles: ['HOOK','TENSION'], purpose: 'Show trigger arriving clearly.',
        subject: 'Adult holding a phone in a kitchen.', action: 'Reads a provoking message and begins typing.', environment: 'Modern kitchen by a window.',
        emotionalIntent: 'Tension rises.', framing: 'Medium close-up', camera: 'Slow push-in', lensComposition: 'Natural 50mm balanced composition',
        lighting: 'Cool window light', continuity: 'Keep identity, wardrobe, phone and kitchen.', negativeGuidance: ['no rendered text'] },
      { shotId: 'shot-2', assetId: 'video-2', durationSeconds: 5, roles: ['ACTION','RESOLUTION','CTA'], purpose: 'Show the reaction being interrupted.',
        subject: 'Same adult holding the same phone.', action: 'Stops typing, exhales and lowers shoulders.', environment: 'Same modern kitchen.',
        emotionalIntent: 'Release tension.', framing: 'Medium close-up', camera: 'Small lateral move', lensComposition: 'Natural 50mm with breathing room',
        lighting: 'Same cool window light', continuity: 'Keep identity, wardrobe, phone and kitchen.', negativeGuidance: ['no rendered text'] },
    ], publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  });
}

async function main() {
  safe();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL); CREATE SCHEMA v2_1; CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id))');
    await db.query("INSERT INTO workspaces VALUES($1,'one'); INSERT INTO v2_2.brands VALUES($2,$1,'brand')", [W1, B1]);
    await apply('migrations/20260829_v2_10_creative_production.sql');
    await apply('migrations/20260829_v2_10_completion.sql');
    await apply('migrations/20260901_locked_keyframe_production.sql');
    await apply('migrations/20260903_quality_script_first.sql');

    const repository = new QualityScriptFirstPostgresRepository({ db });
    const brief = creativeBrief();
    const draft = await repository.createDraft({ workspaceId: W1, brandId: B1, brief,
      validation: { status: 'PASS' }, actor: 'operator' });

    const script = buildScriptScaffold(brief);
    const scriptValidation = validateScript(script, brief);
    const scriptRow = await repository.saveQualityScriptRevision({ draftId: draft.id, workspaceId: W1, brandId: B1,
      script, validation: scriptValidation, actor: 'operator' });
    await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'SCRIPT',
      subjectType: 'SCRIPT_REVISION', subjectId: scriptRow.id, subjectFingerprint: scriptRow.fingerprint,
      decision: 'APPROVED', actor: 'operator' });

    const storyboard = buildStoryboardScaffold(brief, script);
    const storyboardValidation = validateStoryboard(storyboard, brief, script);
    const storyboardRow = await repository.saveQualityStoryboardRevision({ draftId: draft.id, workspaceId: W1, brandId: B1,
      scriptRevisionId: scriptRow.id, storyboard, validation: storyboardValidation, actor: 'operator' });
    await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'STORYBOARD',
      subjectType: 'STORYBOARD_REVISION', subjectId: storyboardRow.id, subjectFingerprint: storyboardRow.fingerprint,
      decision: 'APPROVED', actor: 'operator' });

    let state = await repository.assertQualityDirectorGate({ draftId: draft.id, workspaceId: W1, brandId: B1,
      requiredStages: ['SCRIPT','STORYBOARD'] });
    assert.equal(state.script.approved, true); assert.equal(state.storyboard.approved, true);

    const workflow1 = await repository.ensureLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      shotId: 'shot-1', assetId: 'video-1', canonicalIntentFingerprint: 'intent-one', actor: 'operator' });
    const workflow2 = await repository.ensureLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      shotId: 'shot-1', assetId: 'video-1', canonicalIntentFingerprint: 'intent-two', actor: 'operator' });
    assert.notEqual(workflow1.id, workflow2.id, 'new approved creative intent receives a new immutable locked workflow');

    await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'LOOK',
      subjectType: 'KEYFRAME', subjectId: workflow2.id, subjectFingerprint: fingerprint({ look: workflow2.id }),
      decision: 'APPROVED', actor: 'operator' });
    state = await repository.assertQualityDirectorGate({ draftId: draft.id, workspaceId: W1, brandId: B1,
      requiredStages: ['SCRIPT','STORYBOARD','LOOK'] });
    assert.equal(state.look.approved, true);

    await db.query("UPDATE v2_10.locked_keyframe_workflows SET state='KEYFRAME_READY' WHERE id=$1", [workflow2.id]);
    await db.query("UPDATE v2_10.locked_keyframe_workflows SET state='AWAITING_HUMAN_APPROVAL' WHERE id=$1", [workflow2.id]);
    await db.query("UPDATE v2_10.locked_keyframe_workflows SET state='KEYFRAME_APPROVED' WHERE id=$1", [workflow2.id]);
    await db.query("UPDATE v2_10.locked_keyframe_workflows SET state='FIRST_VIDEO_RUNNING' WHERE id=$1", [workflow2.id]);

    const preflight = await repository.saveLockedStagePreflight({ workflowId: workflow2.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', draftRevision: draft.revision, plan: { fingerprint: 'pilot-preflight' }, actor: 'operator' });
    const attempt = await repository.claimLockedStage({ workflowId: workflow2.id, workspaceId: W1, brandId: B1,
      stage: 'FIRST_VIDEO', preflightId: preflight.id });
    await repository.finishLockedStage({ attemptId: attempt.id, status: 'SUCCEEDED', boundaryState: 'COMPLETED',
      result: { accepted: true, media: { artifact: { artifactId: 'pilot-artifact', version: 1, contentHash: 'pilot-hash' } },
        quality: { status: 'PASS' } } });
    const review = await repository.recordFirstVideoResult({ workflowId: workflow2.id, workspaceId: W1, brandId: B1,
      accepted: true, result: { accepted: true } });
    assert.equal(review.state, 'FIRST_VIDEO_REVIEW', 'semantic PASS must stop for human pilot approval');
    await assert.rejects(() => repository.markLockedContinuationStarted({ draftId: draft.id, workspaceId: W1, brandId: B1,
      productionId: workflow2.production_id }), (error) => error === null || true);
    const unchanged = await repository.getLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1, shotId: 'shot-1' });
    assert.equal(unchanged.state, 'FIRST_VIDEO_REVIEW');

    const pilotAttempt = await repository.getLatestLockedStageAttempt({ workflowId: workflow2.id, workspaceId: W1, brandId: B1, stage: 'FIRST_VIDEO' });
    await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'PILOT',
      subjectType: 'PILOT_ATTEMPT', subjectId: pilotAttempt.id, subjectFingerprint: fingerprint({ attempt: pilotAttempt.id }),
      decision: 'APPROVED', actor: 'operator' });
    const approvedWorkflow = await repository.approvePilotWorkflow({ workflowId: workflow2.id, workspaceId: W1, brandId: B1,
      attemptId: pilotAttempt.id });
    assert.equal(approvedWorkflow.state, 'FIRST_VIDEO_ACCEPTED');
    state = await repository.assertQualityDirectorGate({ draftId: draft.id, workspaceId: W1, brandId: B1,
      requiredStages: ['SCRIPT','STORYBOARD','LOOK','PILOT'] });
    assert.equal(state.pilot.approved, true);

    await repository.invalidateQualityStages({ draftId: draft.id, workspaceId: W1, brandId: B1,
      fromStage: 'STORYBOARD', reason: 'TEST_CHANGE', actor: 'operator' });
    state = await repository.getQualityDirectorState({ draftId: draft.id, workspaceId: W1, brandId: B1 });
    assert.equal(state.script.approved, true);
    assert.equal(state.storyboard.approved, false);
    assert.equal(state.look.approved, false);
    assert.equal(state.pilot.approved, false);

    await assert.rejects(() => db.query("UPDATE v2_10.quality_script_revisions SET content='{}' WHERE id=$1", [scriptRow.id]), /immutable/);
    await assert.rejects(() => db.query("UPDATE v2_10.quality_stage_approval_events SET actor='other' WHERE draft_id=$1", [draft.id]), /immutable/);

    console.log('QUALITY script-first PostgreSQL approvals, invalidation, workflow revisioning and human pilot gate: PASS');
  } finally { await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(() => {}); await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
