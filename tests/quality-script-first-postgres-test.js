'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { HardenedQualityScriptFirstPostgresRepository } = require('../src/v2.10/quality-script-first-repository');
const { buildScriptScaffold, buildStoryboardScaffold, validateScript, validateStoryboard } = require('../src/v2.10/quality-script-first-contract');
const { canonicalCreativeBrief, fingerprint } = require('../src/v2.10/creative-contract');

const W1 = '41000000-0000-4000-8000-000000000001';
const B1 = '41000000-0000-4000-8000-000000000011';
function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : process.env.PGDATABASE || 'content_os'; }
function safe() { if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') throw new Error('QUALITY script-first PostgreSQL tests require a disposable database'); }
const db = process.env.PILOT_TEST_PGLITE === '1' ? require('./helpers/embedded-postgres-pool').embeddedPostgresPool()
  : new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL }
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
    await db.query("INSERT INTO workspaces VALUES($1,'one')", [W1]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'brand')", [B1, W1]);
    await apply('migrations/20260829_v2_10_creative_production.sql');
    await apply('migrations/20260829_v2_10_completion.sql');
    await apply('migrations/20260901_locked_keyframe_production.sql');
    await apply('migrations/20260903_quality_script_first.sql');
    await apply('migrations/20261101_quality_approval_lifecycle.sql');

    const testBytes = new Map();
    const repository = new HardenedQualityScriptFirstPostgresRepository({ db, storage: {
      get: async ({key}) => testBytes.get(key), exists: async ({key}) => testBytes.has(key), put: async ({key,bytes}) => testBytes.set(key,bytes) } });
    const brief = creativeBrief();
    const draft = await repository.createDraft({ workspaceId: W1, brandId: B1, brief,
      validation: { status: 'PASS' }, actor: 'operator' });

    const script = buildScriptScaffold(brief);
    const scriptValidation = validateScript(script, brief);
    assert.equal(scriptValidation.status, 'PASS');
    const scriptRow = await repository.saveQualityScriptRevision({ draftId: draft.id, workspaceId: W1, brandId: B1,
      script, validation: scriptValidation, actor: 'operator' });
    const scriptApproval = await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'SCRIPT',
      subjectType: 'SCRIPT_REVISION', subjectId: scriptRow.id, subjectFingerprint: scriptRow.fingerprint,
      decision: 'APPROVED', actor: 'operator' });
    const duplicateScriptApproval = await repository.recordQualityApproval({ draftId: draft.id, workspaceId: W1, brandId: B1, stage: 'SCRIPT',
      subjectType: 'SCRIPT_REVISION', subjectId: scriptRow.id, subjectFingerprint: scriptRow.fingerprint,
      decision: 'APPROVED', actor: 'operator' });
    assert.equal(duplicateScriptApproval.id, scriptApproval.id, 'exact repeated approval is idempotent');

    const storyboard = buildStoryboardScaffold(brief, script);
    const storyboardValidation = validateStoryboard(storyboard, brief, script);
    assert.equal(storyboardValidation.status, 'PASS');
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
    assert.equal((await repository.getLockedWorkflow({ draftId: draft.id, workspaceId: W1, brandId: B1,
      canonicalIntentFingerprint: 'intent-two' })).id, workflow2.id, 'workflow resolution can target exact creative intent');

    const frame = await repository.storeKeyframeArtifact({ workflowId: workflow2.id, workspaceId: W1, brandId: B1,
      productionId: workflow2.production_id, shotId: 'shot-1', assetId: 'video-1', sourceType: 'OPERATOR_UPLOAD',
      provider: 'operator', model: 'upload', promptFingerprint: 'opening', storageKey: 'immutable/test-opening',
      contentHash: require('node:crypto').createHash('sha256').update('test').digest('hex'), contentType: 'image/png', bytes: Buffer.from('test'), width: 1080, height: 1920,
      actor: 'operator' });
    await repository.recordKeyframeValidation({ keyframeId: frame.id, workspaceId: W1, brandId: B1,
      shotPlanFingerprint: 'opening', result: { status: 'PASS' }, semanticExternalCalls: 0 });
    const approvedFrame = await repository.approveKeyframe({ keyframeId: frame.id, workspaceId: W1, brandId: B1, actor: 'operator' });
    const bound = require('../src/v2.10/locked-keyframe-contract').bindApprovedKeyframe(brief, 'shot-1', approvedFrame);
    await repository.updateDraft({ id: draft.id, workspaceId: W1, brandId: B1, brief: bound, validation: { status: 'PASS' } });
    const look = (await repository.getQualityDirectorState({ draftId: draft.id, workspaceId: W1, brandId: B1 })).look;
    await repository.recordCurrentLookApproval({ draftId: draft.id, workspaceId: W1, brandId: B1,
      keyframeId: frame.id, expectedFingerprint: look.expectedFingerprint, actor: 'operator' });
    state = await repository.assertQualityDirectorGate({ draftId: draft.id, workspaceId: W1, brandId: B1,
      requiredStages: ['SCRIPT','STORYBOARD','LOOK'] });
    assert.equal(state.look.approved, true);

    const { HardenedQualityLockedKeyframeService } = require('../src/v2.10/quality-locked-keyframe-service-hardened');
    const { HardenedQualityScriptFirstService } = require('../src/v2.10/quality-script-first-service-hardened');
    const { createControlServer } = require('../apps/dashboard/server/http-server');
    const scope = { workspaceId: W1, brandId: B1 };
    const brandRepository = { getBrand: async id => id === B1 ? { id, workspaceId: W1 } : null };
    const bytes = Buffer.from('0000ftypisom-synthetic-local-video');
    const artifact = { artifactId: 'pilot-artifact', version: 1, storageKey: 'pilot/video-1',
      contentHash: require('node:crypto').createHash('sha256').update(bytes).digest('hex') };
    testBytes.set(artifact.storageKey, bytes);
    let generationCalls = 0;
    const starter = {
      preflightLockedFirstVideo: async () => ({ plan: { fingerprint: 'pilot-preflight' } }),
      startLockedFirstVideo: async ({ beforeProviderBoundary, onProviderRequest }) => {
        await beforeProviderBoundary();
        assert.equal((await repository.getLockedWorkflow({ draftId: draft.id, ...scope })).state,
          'FIRST_VIDEO_RUNNING', 'real service must advance workflow before provider submission');
        generationCalls++;
        await onProviderRequest({ requestId: 'synthetic-prediction' });
        return { accepted: true, productionId: workflow2.production_id, jobId: 'synthetic-job',
          media: { assetId: 'video-1', provider: 'synthetic', model: 'test', requestId: 'synthetic-prediction', artifact },
          quality: { status: 'WARN', checks: [{ code: 'PROP_NOT_VISIBLE', status: 'WARN', reason: 'Bag placement is not visible.' }],
            metadata: { externalCalls: 1, provider: 'synthetic', model: 'test' } } };
      },
    };
    const locked = new HardenedQualityLockedKeyframeService({ repository, brandRepository, starter,
      providerCatalog: {}, storage: repository.storage, imageInspector: {} });
    const director = new HardenedQualityScriptFirstService({ repository, brandRepository });
    await repository.savePreflight({ id: draft.id, ...scope, preflight: { status: 'READY', fingerprint: 'full' }, preflightRequest: {}, actor: 'operator' });
    const preflight = await locked.preflightFirstVideo({ id: draft.id, brandId: B1, keyframeId: frame.id });
    const startArgs = { id: draft.id, brandId: B1, keyframeId: frame.id, preflightId: preflight.preflightId,
      fingerprint: preflight.fingerprint, confirmation: true };
    const recordResult = repository.recordFirstVideoResult.bind(repository);
    repository.recordFirstVideoResult = async () => { throw new Error('injected failure after result persistence'); };
    await assert.rejects(() => locked.startFirstVideo(startArgs), error => error.code === 'PILOT_REVIEW_SYNC_REQUIRED');
    repository.recordFirstVideoResult = recordResult;
    const pilotAttempt = await repository.getLatestLockedStageAttempt({ workflowId: workflow2.id, ...scope, stage: 'FIRST_VIDEO' });
    assert.equal(pilotAttempt.status, 'SUCCEEDED');
    assert.equal(pilotAttempt.provider_request_id, 'synthetic-prediction');
    assert.equal(pilotAttempt.result.quality.status, 'WARN');
    assert.equal(pilotAttempt.result.readyForContinuationPreflight, false, 'persisted result cannot skip human review');
    assert.equal(pilotAttempt.result.nextRequiredAction, 'APPROVE_LOOK_AND_MOTION');
    const evidenceBeforeRecovery = JSON.stringify(pilotAttempt);
    const server = createControlServer({ service: {}, qualityDirectorService: director, logger: { error() {} } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const prefix = `/api/v2.10/creative-drafts/${draft.id}/quality-director`;
    const post = async (action, body) => {
      const response = await fetch(base + prefix + '/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId: B1, ...body }) });
      return { status: response.status, body: await response.json() };
    };
    try {
      let restored = await (await fetch(base + prefix + `?brandId=${B1}`)).json();
      assert(restored.pilotReview.canRestoreReview, 'saved result remains visible after process reload');
      assert(!restored.pilotReview.canApprove, 'unsynchronized state cannot be approved');
      const decision = { workflowId: workflow2.id, attemptId: pilotAttempt.id, confirmation: true };
      assert.equal((await post('pilot-restore-review', { ...decision, attemptId: workflow1.id })).status, 409);
      restored = (await post('pilot-restore-review', decision)).body;
      assert.equal(restored.workflow.state, 'FIRST_VIDEO_REVIEW');
      assert.equal(restored.pilotReview.canApprove, true);
      assert.equal(restored.pilotReview.quality.checks[0].reason, 'Bag placement is not visible.');
      assert(!restored.pilotReview.canRestoreReview);
      assert.equal((await post('pilot-restore-review', decision)).status, 200, 'restore is idempotent');
      const contentUrl = base + restored.pilotReview.contentUrl;
      const full = await fetch(contentUrl);
      assert.equal(full.status, 200); assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
      const range = await fetch(contentUrl, { headers: { Range: 'bytes=4-7' } });
      assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
      assert.equal((await fetch(contentUrl, { headers: { Range: 'bytes=9999-' } })).status, 416);
      assert.equal((await fetch(contentUrl.replace(pilotAttempt.id, workflow1.id))).status, 404);
      assert.equal((await fetch(contentUrl.replace(B1, workflow1.id))).status, 404, 'cross-brand read denied');
      testBytes.set(artifact.storageKey, Buffer.from('tampered'));
      assert.equal((await fetch(contentUrl)).status, 409);
      assert.equal((await post('pilot-approve', decision)).status, 409, 'corrupt artifact cannot be approved');
      testBytes.set(artifact.storageKey, bytes);
      assert.equal((await post('pilot-approve', { ...decision, attemptId: workflow1.id })).status, 404);
      assert.equal((await repository.markLockedContinuationStarted({ draftId: draft.id, ...scope, productionId: workflow2.production_id })), null);
      await locked.startFirstVideo(startArgs); // reuses the journal; no second provider call
      assert.equal(generationCalls, 1);
      // A failure during the final state write must roll back its approval event too.
      await db.query(`CREATE FUNCTION v2_10.fail_pilot_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.state='FIRST_VIDEO_ACCEPTED' THEN RAISE EXCEPTION 'injected decision failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_fail_decision BEFORE UPDATE ON v2_10.locked_keyframe_workflows FOR EACH ROW EXECUTE FUNCTION v2_10.fail_pilot_decision()`);
      assert.equal((await post('pilot-approve', decision)).status, 500);
      assert.equal((await repository.getQualityDirectorState({ draftId: draft.id, ...scope })).pilot.approved, false);
      await db.query('DROP TRIGGER test_fail_decision ON v2_10.locked_keyframe_workflows');
      const approved = await post('pilot-approve', decision);
      assert.equal(approved.status, 200); assert.equal(approved.body.workflow.state, 'FIRST_VIDEO_ACCEPTED');
      const again = await post('pilot-approve', decision);
      assert.equal(again.body.approvalEventId, approved.body.approvalEventId, 'duplicate approval reuses the decision');
      assert.equal((await post('pilot-reject', decision)).status, 409, 'cannot overwrite approval');
      assert.equal((await post('pilot-restore-review', decision)).body.workflow.state, 'FIRST_VIDEO_ACCEPTED');
      assert.equal(JSON.stringify(await repository.getLatestLockedStageAttempt({ workflowId: workflow2.id, ...scope, stage: 'FIRST_VIDEO' })), evidenceBeforeRecovery);
      assert.equal(generationCalls, 1, 'playback, recovery and decisions never invoke generation');
    } finally { await new Promise(resolve => server.close(resolve)); }
    state = await repository.assertQualityDirectorGate({ draftId: draft.id, ...scope, requiredStages: ['SCRIPT','STORYBOARD','LOOK','PILOT'] });
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

    // Sibling outcomes use the same real boundary and SQL constraints.
    for (const outcome of ['PASS','FAIL','UNKNOWN','LEGACY_COMPLETED','INVALID_STATE']) {
      const wf = await repository.ensureLockedWorkflow({ draftId: draft.id, ...scope, shotId: 'shot-1', assetId: 'video-1',
        canonicalIntentFingerprint: 'outcome-' + outcome, actor: 'test' });
      if (outcome !== 'INVALID_STATE') {
        const k = await repository.storeKeyframeArtifact({ workflowId: wf.id, ...scope, productionId: wf.production_id,
          shotId: 'shot-1', assetId: 'video-1', sourceType: 'OPERATOR_UPLOAD', provider: 'synthetic', model: 'test',
          bytes: Buffer.from('test'), contentHash: frame.content_hash, contentType: 'image/png', width: 720, height: 1280,
          promptFingerprint: outcome, actor: 'test' });
        await repository.recordKeyframeValidation({ keyframeId: k.id, ...scope, shotPlanFingerprint: outcome, result: { status: 'PASS' }, semanticExternalCalls: 0 });
        await repository.approveKeyframe({ keyframeId: k.id, ...scope, actor: 'test' });
      }
      const pf = await repository.saveLockedStagePreflight({ workflowId: wf.id, ...scope, stage: 'FIRST_VIDEO', draftRevision: 1, plan: { fingerprint: outcome }, actor: 'test' });
      const a = await repository.claimLockedStage({ workflowId: wf.id, ...scope, stage: 'FIRST_VIDEO', preflightId: pf.id });
      if (outcome === 'INVALID_STATE') {
        await assert.rejects(() => repository.markLockedStageBoundary({ attemptId: a.id }), e => e.code === 'PILOT_START_STATE_CONFLICT');
        assert.equal((await repository.getLatestLockedStageAttempt({ workflowId: wf.id, ...scope, stage: 'FIRST_VIDEO' })).boundary_state, 'NOT_CROSSED', 'boundary rolls back if workflow rejects start');
        continue;
      }
      if (outcome !== 'LEGACY_COMPLETED') await repository.markLockedStageBoundary({ attemptId: a.id });
      if (outcome === 'UNKNOWN') {
        await repository.finishLockedStage({ attemptId: a.id, status: 'NEEDS_RECONCILIATION', boundaryState: 'MAY_HAVE_STARTED' });
        await assert.rejects(() => repository.recordFirstVideoResult({ workflowId: wf.id, ...scope, attemptId: a.id, accepted: true }), e => e.code === 'PILOT_RESULT_EVIDENCE_REQUIRED');
        await assert.rejects(() => repository.assertLockedStageAvailable({ workflowId: wf.id, ...scope, stage: 'FIRST_VIDEO' }));
        continue;
      }
      const accepted = outcome !== 'FAIL';
      await repository.finishLockedStage({ attemptId: a.id, status: accepted ? 'SUCCEEDED' : 'FAILED', boundaryState: 'COMPLETED',
        result: { accepted, media: { artifact }, quality: { status: accepted ? 'PASS' : 'FAIL' } } });
      const projected = await repository.recordFirstVideoResult({ workflowId: wf.id, ...scope, attemptId: a.id, accepted });
      assert.equal(projected.state, accepted ? 'FIRST_VIDEO_REVIEW' : 'FIRST_VIDEO_FAILED');
    }
    console.log('PASS real service + HTTP + PostgreSQL: one synthetic pilot, WARN/reload/playback/ranges/hash/isolation, saved-result recovery, atomic exact approval, duplicates, PASS/FAIL/unknown and legacy recovery. Real provider calls: 0.');
  } finally { await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(() => {}); await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
