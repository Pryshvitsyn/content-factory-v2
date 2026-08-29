'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { CreativeProductionService } = require('../src/v2.10/creative-production-service');
const { V210PostgresRepository } = require('../src/v2.10/postgres-repository');
const { V210IntegratedProductionStarter } = require('../src/v2.10/integrated-starter');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { voiceConfigurationFingerprint } = require('../src/v2.10/voice-studio');

const W = '21000000-0000-4000-8000-000000000101';
const B = '21000000-0000-4000-8000-000000000111';
const PREVIEW = '21000000-0000-4000-8000-000000000121';
const ACTOR = 'operator-exact-flow-certification';

function databaseName() {
  return process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')
    : process.env.PGDATABASE || 'content_os';
}
function safe() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || databaseName() === 'content_os') {
    throw new Error('V2.10 exact-flow PostgreSQL test requires CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database');
  }
}
const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE,
});
async function apply(file) {
  const sql = await fs.readFile(path.resolve(file), 'utf8');
  await db.query(sql); await db.query(sql);
}

function shot(index, roles, action, emotionalIntent, voiceoverSegment = '') {
  return {
    shotId: `attune-shot-${index}`, assetId: `attune-video-${index}`, durationSeconds: 5, roles,
    purpose: index === 1 ? 'Establish an ambiguous emotional shift before reaction'
      : index === 2 ? 'Show the partner choosing attention instead of assumption'
        : 'Resolve the tension and land the restrained Attune call to action',
    subject: 'The same adult couple in their early thirties seated together on a green living-room sofa',
    action, environment: 'The same warm lived-in apartment living room with green sofa oak table and two brass lamps',
    emotionalIntent, framing: index === 1 ? 'Vertical eye-level medium-wide two-person composition' : 'Vertical eye-level closer medium two-person composition',
    camera: index === 3 ? 'Restrained slow push-in with natural observational movement' : 'Restrained observational movement with no dramatic camera move',
    lensComposition: 'Natural perspective balanced two-person composition with believable personal space',
    lighting: 'Warm practical brass lamps with believable skin tones soft evening contrast and no commercial gloss',
    continuity: 'Preserve the exact same couple appearance wardrobe sofa room layout props lighting and camera language',
    negativeGuidance: ['travel', 'cars', 'restaurants', 'outdoors', 'generated text', 'watermarks', 'melodrama', 'stock-ad smiling'],
    referencePolicy: 'NONE', voiceoverSegment,
  };
}

function attuneBrief() {
  const voice = {
    sourceType: 'AI_PRESET', provider: 'openai', model: 'gpt-4o-mini-tts', voiceId: 'sage', language: 'en',
    instructions: 'Warm restrained natural adult delivery. Quiet confidence, no announcer cadence.',
    previewArtifact: { artifactId: PREVIEW, durationSeconds: 7.2, storageKey: 'immutable/voice/attune-preview', contentHash: 'preview-content-hash' },
    approved: true,
  };
  voice.approvedConfigurationFingerprint = voiceConfigurationFingerprint(voice);
  return {
    title: 'Attune Creative #2 — Notice the Moment',
    objective: 'Help couples notice emotional shifts before reacting and introduce Attune as a gentle tool for more understanding.',
    targetPlatform: 'Instagram Reels', targetDurationSeconds: 15,
    hook: 'Sometimes distance is not rejection.',
    coreMessage: 'Before you assume, notice the moment and respond with attention instead of reaction.',
    cta: "Don't guess. Tune in.",
    audienceIntent: 'Thoughtful couples who want to pause before assuming and avoid unnecessary escalation',
    creativeConcept: 'A single believable apartment moment moves from ambiguous distance through a deliberate pause to quiet reconnection',
    visualStyle: 'Warm restrained cinematic naturalism with authentic microexpressions practical lighting and no stock-ad look',
    storyboard: [
      shot(1, ['HOOK', 'TENSION'],
        'The woman becomes quieter and turns slightly away while her partner notices, nearly reacts, then deliberately does not',
        'Subtle uncertainty and restrained tension without anger crying or melodrama'),
      shot(2, ['INSIGHT', 'ACTION'],
        'The partner pauses, softens their expression, then gently reaches for her hand as she looks back',
        'A visible shift from assumption toward curiosity and attentive connection', 'Before you assume, notice the moment.'),
      shot(3, ['RESOLUTION', 'CTA'],
        'The tension softens into a small authentic relaxed expression while the couple remains naturally seated together',
        'Quiet relief and believable reconnection without exaggerated smiling or hugging', "Don't guess. Tune in."),
    ],
    continuity: {
      identity: 'One consistent adult couple throughout all three shots with no extra people',
      appearance: 'Partner one has short dark curls and partner two has shoulder-length auburn hair with natural everyday styling',
      wardrobe: 'Blue cotton overshirt and cream knit sweater remain exactly unchanged across all three shots',
      environment: 'The same warm apartment living room with green sofa oak table and two brass lamps throughout',
      props: 'Green sofa oak table ceramic mug and two brass lamps remain in the same believable positions',
      lightingColorLanguage: 'Warm amber practical lamps believable skin tones and soft evening contrast throughout',
      cameraLanguage: 'Vertical eye-level restrained observational camera with natural perspective and only a subtle final push-in',
      referencePolicy: 'NONE',
    },
    voice,
    postProduction: { endTitle: { enabled: true, text: "Don't guess. Tune in.", startTime: 13, duration: 2 }, brandName: 'Attune' },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}

const VIDEO = Object.freeze({ provider: 'replicate', model: 'alibaba/wan-3', modelFamily: 'WAN_3',
  profile: 'STANDARD', resolution: '720p' });
const PLAN = Object.freeze({ readiness: 'READY', expectedVideoGenerations: 3, expectedAudioGenerations: 1,
  expectedSemanticEvaluationCalls: 4, expectedContinuityEvaluationCalls: 1,
  masterAssemblyMode: 'ffmpeg-multi-track', semanticEvaluatorProvider: 'mock-semantic', semanticEvaluatorModel: 'mock-semantic-v1' });

class ExactFlowStarter extends V210IntegratedProductionStarter {
  constructor(options) {
    super(options);
    this.preparedInputs = [];
    this.createdInputs = [];
    this.existingCanonical = new Map();
    this.providerRuns = 0;
  }
  runtime(input, live) {
    const owner = this;
    return {
      config: { testOnly: true }, env: { ...this.env, LIVE_PAID_GENERATION: live ? 'true' : 'false' },
      service: {
        async prepare({ input: prepared }) {
          owner.preparedInputs.push(prepared);
          assert.equal(prepared.fingerprint, input.fingerprint, 'preflight must prepare the revision-safe canonical input');
          return { plan: PLAN };
        },
        async createDraft({ input: created, command }) {
          owner.createdInputs.push(created);
          const legacyKey = `v210-${command.requestId}`;
          assert.notEqual(created.productionKey, legacyKey, 'current V2.10 must never reuse the legacy draft-only production key');
          const existingFingerprint = owner.existingCanonical.get(created.productionKey);
          if (existingFingerprint && existingFingerprint !== created.fingerprint) {
            const error = new Error('Existing production does not match brand or structured input');
            error.code = 'EXISTING_PRODUCTION_MISMATCH'; throw error;
          }
          owner.existingCanonical.set(created.productionKey, created.fingerprint);
          const production = (await owner.db.query(
            'INSERT INTO v2_1.productions(workspace_id,brand_id) VALUES($1,$2) RETURNING id', [W, B])).rows[0];
          return { production, job: { id: 'exact-flow-canonical-job' } };
        },
        async run() { owner.providerRuns += 1; },
      },
    };
  }
}

async function main() {
  safe();
  try {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP SCHEMA IF EXISTS v2_1 CASCADE; DROP TABLE IF EXISTS public.workspaces CASCADE');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL); CREATE SCHEMA v2_1; CREATE TABLE v2_1.productions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),brand_id uuid NOT NULL REFERENCES v2_2.brands(id))');
    await db.query("INSERT INTO workspaces VALUES($1,'exact-flow')", [W]);
    await db.query("INSERT INTO v2_2.brands VALUES($1,$2,'Attune')", [B, W]);
    await apply('migrations/20260829_v2_10_creative_production.sql');
    await apply('migrations/20260829_v2_10_completion.sql');

    const brief = attuneBrief();
    await db.query(`INSERT INTO v2_10.voice_preview_artifacts
      (id,workspace_id,brand_id,preview_fingerprint,provider,model,voice_id,configuration,preview_text_hash,storage_key,content_hash,content_type,duration_seconds,external_call_count,provenance)
      VALUES($1,$2,$3,'attune-preview-fingerprint','openai','gpt-4o-mini-tts','sage',$4,'preview-text-hash','immutable/voice/attune-preview','preview-content-hash','audio/mpeg',7.2,1,$5)`,
    [PREVIEW, W, B, brief.voice, { source: 'EXPLICIT_OPERATOR_PREVIEW', externalCalls: 1 }]);

    const repository = new V210PostgresRepository({ db });
    const env = { LIVE_PAID_GENERATION: 'true', REPLICATE_API_TOKEN: 'test-replicate', OPENAI_API_KEY: 'test-openai' };
    const providerCatalog = new ProviderCatalog({ env });
    const scheduled = [];
    const starter = new ExactFlowStarter({ db, storage: {}, repository, env, logger: { error() {} },
      credentialCheck: () => true, mediaInspector: {}, scheduler: (task) => scheduled.push(task) });
    const brandRepository = { async getBrand(id) { return id === B ? { id: B, workspaceId: W, name: 'Attune' } : null; } };
    const service = new CreativeProductionService({ repository, brandRepository, providerCatalog, starter,
      env, actor: ACTOR, previewProvider: null, storage: null, audioInspector: null });

    const created = await service.createDraft({ brandId: B, brief, providerSelection: VIDEO, voiceSelection: brief.voice });
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.creative_validation.status, 'PASS', 'Attune 3-shot creative must remain complete');

    // Model the user's persisted state after the old draft-only canonical identity failed before any provider boundary.
    const legacyPreflight = { schemaVersion: '2.10', status: 'READY', blockers: [], fingerprint: 'legacy-preflight-fingerprint',
      humanApprovalRequired: true, autoPublish: false };
    await repository.savePreflight({ id: created.id, workspaceId: W, brandId: B, preflight: legacyPreflight,
      preflightRequest: { video: VIDEO, timingToleranceSeconds: 0 }, actor: ACTOR });
    const oldClaim = await repository.claimStart({ id: created.id, workspaceId: W, brandId: B,
      fingerprint: legacyPreflight.fingerprint, actor: ACTOR, canonicalInputFingerprint: 'legacy-canonical-fingerprint' });
    await repository.finishStartFailure({ id: created.id, workspaceId: W, brandId: B, attempt: oldClaim.startAttempt,
      error: Object.assign(new Error('Existing production does not match brand or structured input'), { code: 'EXISTING_PRODUCTION_MISMATCH' }),
      boundaryState: 'NOT_CROSSED', phase: 'START_FAILED' });

    let state = await repository.getDraft({ id: created.id, workspaceId: W, brandId: B });
    assert.equal(state.start_state, 'FAILED_RETRYABLE');
    assert.equal(state.preflight_fingerprint, legacyPreflight.fingerprint);
    const revisionBeforeNoop = state.revision;

    // This is the Dashboard's persistDraft() immediately before FINAL PRODUCTION PREFLIGHT.
    const noop = await service.updateDraft({ id: created.id, brandId: B, brief: state.creative_brief,
      providerSelection: state.provider_selection, voiceSelection: state.voice_selection });
    assert.equal(noop.status, 'PREFLIGHT_READY', 'semantic no-op save must preserve READY evidence instead of violating the DB CHECK');
    assert.equal(noop.preflight_fingerprint, legacyPreflight.fingerprint);
    assert.equal(noop.revision, revisionBeforeNoop, 'semantic no-op save must not create a fake revision');
    assert.equal(noop.start_state, 'FAILED_RETRYABLE');

    const final = await service.preflight({ id: created.id, brandId: B, video: VIDEO });
    assert.equal(final.status, 'READY');
    assert.notEqual(final.fingerprint, legacyPreflight.fingerprint, 'fresh authoritative preflight must replace stale legacy evidence');
    assert.equal(final.video.provider, 'replicate');
    assert.equal(final.video.model, 'alibaba/wan-3');
    assert.equal(final.video.profile, 'STANDARD');
    assert.equal(final.video.resolvedSettings.resolution, '720p');
    assert.equal(final.creative.storyboardShots, 3);
    assert.equal(final.creative.completeness, 'PASS');
    assert.equal(final.creative.continuity, 'READY');
    assert.equal(final.voice.sourceType, 'AI_PRESET');
    assert.equal(final.voice.previewApproved, true);
    assert.deepEqual(final.externalCalls, { video: 3, speech: 1, semantic: 4, otherEvaluator: 1, maximum: 9 });
    assert.equal(final.externalCalls.maximum,
      final.externalCalls.video + final.externalCalls.speech + final.externalCalls.semantic + final.externalCalls.otherEvaluator,
      'maximum external calls must be fully explainable by visible accounting categories');
    assert.equal(final.master.profile, 'SOCIAL_VERTICAL');
    assert.equal(final.master.resolution, '1080x1920');
    assert.equal(final.master.fps, 30);
    assert.equal(final.costStatus, 'VERIFIED');
    assert.equal(final.humanApprovalRequired, true);
    assert.equal(final.autoPublish, false);

    state = await repository.getDraft({ id: created.id, workspaceId: W, brandId: B });
    assert.equal(state.status, 'PREFLIGHT_READY');
    assert.equal(state.start_state, 'IDLE', 'fresh preflight must explicitly clear a safe FAILED_RETRYABLE state');
    assert.equal(state.preflight_fingerprint, final.fingerprint);

    // Seed the exact legacy key that caused the user's original collision. Current START must choose another identity.
    const legacyProductionKey = `v210-${created.id}`;
    starter.existingCanonical.set(legacyProductionKey, 'older-structured-input-fingerprint');

    const started = await service.start({ id: created.id, brandId: B, confirmation: true });
    assert.equal(started.accepted, true);
    assert.equal(started.humanApprovalRequired, true);
    assert.equal(started.autoPublish, false);
    assert.equal(started.publicationTriggered, false);
    assert.ok(started.productionId);
    assert.equal(scheduled.length, 1, 'canonical run may be scheduled only after a successful exact START claim');
    assert.equal(starter.providerRuns, 0, 'certification must never execute the scheduled provider task');
    assert.equal(starter.createdInputs.length, 1);
    const startedInput = starter.createdInputs[0];
    assert.match(startedInput.productionKey, new RegExp(`^v210-${created.id}-[a-f0-9]{16}$`));
    assert.notEqual(startedInput.productionKey, legacyProductionKey);
    assert.equal(starter.existingCanonical.get(legacyProductionKey), 'older-structured-input-fingerprint',
      'legacy canonical evidence must remain untouched');
    assert.equal(startedInput.fingerprint, final.canonicalInputFingerprint,
      'START must use the same exact canonical input certified by FINAL PRODUCTION PREFLIGHT');
    assert.deepEqual(startedInput.postProduction, brief.postProduction, 'approved post-production values must survive exact preflight/start');

    state = await repository.getDraft({ id: created.id, workspaceId: W, brandId: B });
    assert.equal(state.status, 'STARTED');
    assert.equal(state.start_state, 'SUCCEEDED');
    assert.equal(state.production_id, started.productionId);
    const attempts = await repository.startAttempts({ id: created.id, workspaceId: W, brandId: B });
    assert.deepEqual(attempts.map((row) => row.status), ['SUCCEEDED', 'FAILED_RETRYABLE']);
    assert.deepEqual(attempts.map((row) => row.attempt), [2, 1]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM v2_10.voice_preview_artifacts WHERE id=$1', [PREVIEW])).rows[0].count, 1,
      'exact flow must reuse approval evidence without generating another voice preview');
    assert.equal(starter.providerRuns, 0);

    console.log('V2.10 exact Attune retry -> no-op save -> authoritative preflight -> revision-safe START passed; real provider calls = 0.');
  } finally {
    await db.query('DROP SCHEMA IF EXISTS v2_10 CASCADE').catch(() => {});
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
