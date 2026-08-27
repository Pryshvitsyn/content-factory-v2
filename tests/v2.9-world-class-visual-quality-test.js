'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateFixtureDirectory, FIXTURES } = require('./fixtures/v2.9/generate-visual-fixtures');
const { FfprobeMediaInspector } = require('../src/v2.5/media-validator');
const { VisualQualityEvaluator } = require('../src/v2.9/visual-quality-evaluator');
const { FunctionSemanticVisualEvaluatorAdapter, DisabledSemanticVisualEvaluatorAdapter } = require('../src/v2.9/semantic-visual-evaluator');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { canonicalNegativeIntent, translateProviderPrompt } = require('../src/v2.9/negative-intent');
const { AudioQualityEvaluator } = require('../src/v2.9/audio-editorial-quality');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { ProviderCatalog } = require('../src/v2.8/provider-catalog');
const { QualityRendererLane } = require('../src/v2.6/renderer-router');
const { classifyRejectionReason } = require('../src/v2.3/control-review-service');
const { progressFor } = require('../apps/dashboard/server/control-service');

const BRAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const brand = { id: BRAND_ID, workspaceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Attune', status: 'ACTIVE',
  products: [], audiences: [], offers: [], campaigns: [] };

function semanticAdapter() {
  return new FunctionSemanticVisualEvaluatorAdapter({ provider: 'fixture-semantic', model: 'deterministic-test',
    estimatedCallsPerEvaluation: 0,
    evaluate: async ({ creativePlan, qualityTier }) => {
      const fixture = creativePlan?.fixture;
      const text = fixture === 'fakeTextLike';
      const pip = fixture === 'pictureInPicture';
      const checks = [qualityCheck({
        code: text ? REASON_CODES.PSEUDO_TEXT_ARTIFACT : 'SEMANTIC_SINGLE_COMPOSITION',
        status: text ? 'FAIL' : 'PASS', qualityClass: 'SEMANTIC_VISUAL',
        reason: text ? 'Prominent generated text-like marks are visible under a strict no-text policy.' : 'Semantic fixture preserves one intended scene.',
      }), qualityCheck({
        code: REASON_CODES.PICTURE_IN_PICTURE_UNEXPECTED, status: pip ? 'FAIL' : 'PASS',
        qualityClass: 'SEMANTIC_VISUAL', hardFailure: pip,
        reason: pip ? 'Unexpected picture-in-picture region is visible.' : 'No unexpected picture-in-picture was identified.',
      })];
      return qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier: qualityTier, checks,
        metadata: { configured: true, externalCalls: 0 } });
    } });
}

async function inspect(file) {
  const bytes = await fs.readFile(file);
  const probe = await new FfprobeMediaInspector().inspect({ bytes, contentType: 'video/mp4', kind: 'video' });
  return { bytes, probe };
}

async function evaluateFixture(directory, name, semantic = semanticAdapter()) {
  const { bytes, probe } = await inspect(path.join(directory, `${name}.mp4`));
  const evaluator = new VisualQualityEvaluator({ semanticAdapter: semantic });
  const result = await evaluator.evaluate({ media: { bytes, contentType: 'video/mp4', mediaProbe: probe },
    creativePlan: { fixture: name }, expectedAspectRatio: '9:16', qualityTier: 'STANDARD',
    provider: 'fixture', model: name, generationSettings: { fixture: true } });
  return { bytes, probe, result, evaluator };
}

function fakeArtifactService(calls = []) {
  let version = 0;
  return { async createVersion({ artifactId, content, provider, model, validationStatus }) {
    calls.push({ artifactId, provider, model, validationStatus });
    version += 1; const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    return Object.freeze({ artifactId, version, storageKey: `quality/${version}.bin`,
      contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), provenance: { provider, model } });
  } };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v29-fixtures-'));
  try {
    const manifest = generateFixtureDirectory(directory);
    assert.deepEqual(Object.keys(manifest.fixtures).sort(), Object.keys(FIXTURES).sort());
    assert.equal(Object.keys(manifest.fixtures).length, 12);
    assert.equal(manifest.paidProviderCalls, 0);

    const single = await evaluateFixture(directory, 'singleComposition');
    assert.equal(single.probe.status, 'PASS');
    assert.equal(single.result.status, 'PASS');
    assert.equal(single.result.sampledFrames.length, 7);
    assert.deepEqual(single.result.sampledFrames.map((frame) => frame.ratio), [0.02,0.1,0.3,0.5,0.7,0.9,0.98]);

    const triptych = await evaluateFixture(directory, 'triptych');
    assert.equal(triptych.probe.status, 'PASS', 'technically valid triptych remains technically valid');
    assert.equal(triptych.result.status, 'FAIL', 'technically valid triptych must fail visual QA');
    assert(triptych.result.checks.some((check) => check.code === REASON_CODES.TRIPTYCH_DETECTED && check.status === 'FAIL'));
    for (const fixture of ['verticalSplit','horizontalSplit','contactSheet','blankFrames','freezeStatic','visuallyUnacceptable']) {
      const evaluated = await evaluateFixture(directory, fixture);
      assert.equal(evaluated.result.status, 'FAIL', `${fixture} must fail`);
      if (fixture === 'visuallyUnacceptable') assert(evaluated.result.checks.some((check) => (
        check.code === REASON_CODES.TEMPORAL_FLICKER && check.status === 'FAIL')));
    }
    const text = await evaluateFixture(directory, 'fakeTextLike');
    assert(text.result.checks.some((check) => check.code === REASON_CODES.PSEUDO_TEXT_ARTIFACT && check.status === 'FAIL'));
    const pip = await evaluateFixture(directory, 'pictureInPicture');
    assert(pip.result.checks.some((check) => check.code === REASON_CODES.PICTURE_IN_PICTURE_UNEXPECTED && check.status === 'FAIL'));
    await assert.rejects(() => inspect(path.join(directory, 'technicalFailureVisuallyNormal.mp4')),
      (error) => ['MEDIA_DURATION_INVALID','MEDIA_UNREADABLE'].includes(error.code));

    const unconfigured = await evaluateFixture(directory, 'singleComposition', new DisabledSemanticVisualEvaluatorAdapter());
    assert.equal(unconfigured.result.status, 'FAIL');
    assert(unconfigured.result.checks.some((check) => check.code === REASON_CODES.SEMANTIC_VISUAL_QA_NOT_CONFIGURED));

    const disabledAdapter = new DisabledSemanticVisualEvaluatorAdapter();
    const lane = new QualityRendererLane({ masterOrchestrator: { build() {} },
      qualityEvaluator: { semanticAdapter: disabledAdapter } });
    const planForTier = (profile) => lane.plan({ input: { assetPlan: { assets: [{ kind: 'video', asset_id: 'video-1',
      generation_requirements: { profile } }] } }, config: {}, existing: null,
      laneState: { executions: [], availability: { configured: true, status: 'READY' } } });
    assert.equal(planForTier('STANDARD').readiness, 'BLOCKED');
    assert.equal(planForTier('PREMIUM').readiness, 'BLOCKED');
    assert.equal(planForTier('ECONOMY').readiness, 'READY');
    assert.equal(planForTier('STANDARD').qualityEvaluatorPolicy, REASON_CODES.SEMANTIC_VISUAL_QA_NOT_CONFIGURED);
    const incompleteContinuity = await semanticAdapter().evaluateContinuity({ qualityTier: 'STANDARD',
      shotEvaluations: [{ assetId: 'one' }, { assetId: 'two' }] });
    assert.equal(incompleteContinuity.status, 'FAIL');
    assert(incompleteContinuity.checks.some((check) => check.code === REASON_CODES.CONTINUITY_FAILURE));

    const intent = canonicalNegativeIntent();
    const wan = translateProviderPrompt({ canonicalPrompt: 'A quiet couple at home.', negativeIntent: intent,
      provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast' });
    assert.equal(wan.canonicalPrompt, 'A quiet couple at home.');
    assert.match(wan.providerPrompt, /one continuous cinematic shot/i);
    assert.equal(intent.delivery.importantCopyInPostProduction, true);

    const catalog = new ProviderCatalog({ env: { REPLICATE_API_TOKEN: 'synthetic' } });
    const standard = catalog.resolveSelection({ provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast',
      profile: 'STANDARD', capability: 'TEXT_TO_VIDEO', aspectRatio: '9:16' });
    assert.equal(standard.profile, 'STANDARD'); assert.equal(standard.resolvedSettings.resolution, '720p');
    assert.equal(standard.resolvedSettings.framesPerSecond, 24); assert.equal(standard.resolvedSettings.goFast, false);
    assert.equal(standard.resolvedSettings.optimizePrompt, true); assert.equal(standard.resolvedSettings.interpolateOutput, true);
    assert.throws(() => catalog.resolveSelection({ provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast', profile: 'PREMIUM' }),
      (error) => error.code === 'SELECTED_PROFILE_UNAVAILABLE');
    const economy = catalog.resolveSelection({ provider: 'replicate', model: 'wan-video/wan-2.2-t2v-fast', profile: 'ECONOMY' });
    assert.equal(economy.profile, 'ECONOMY'); assert.equal(economy.resolvedSettings.resolution, '480p');

    const built = buildOperatorProductionInput({ requestId: REQUEST_ID, brandId: BRAND_ID, renderMode: 'QUALITY',
      title: 'Visual gate', objective: 'ENGAGEMENT', platform: 'Instagram Reels', targetDurationSeconds: 5,
      aspectRatio: '9:16', hook: 'Notice first', coreMessage: 'Attention helps', creativeBrief: 'A couple at home', cta: 'Tune in' },
    brand, { qualityProfile: { name: 'STANDARD', provider: 'replicate', vendor: 'wan-video',
      model: 'wan-video/wan-2.2-t2v-fast', capability: 'TEXT_TO_VIDEO', resolution: '720p', numFrames: 121,
      framesPerSecond: 24, goFast: false, optimizePrompt: true, interpolateOutput: true, sampleShift: 12,
      seedStrategy: 'per-shot-deterministic', resolvedSettings: standard.resolvedSettings } });
    const videoAsset = built.input.assetPlan.assets.find((asset) => asset.kind === 'video');
    const assetPlan = { ...built.input.assetPlan, assets: [videoAsset] };
    const shotPlan = { ...built.input.shotPlan, shots: built.input.shotPlan.shots.map((shot) => ({ ...shot,
      required_assets: shot.required_assets.filter((id) => id === videoAsset.asset_id) })) };
    let renderCalls = 0;
    const orchestrator = new MasterProductionOrchestrator({ providerGateway: { generate() { throw new Error('provider call forbidden'); } },
      artifactService: fakeArtifactService(), renderer: { async render() { renderCalls += 1; throw new Error('must be blocked'); } },
      sourceQualityEvaluator: triptych.evaluator, finalQualityEvaluator: triptych.evaluator });
    await assert.rejects(() => orchestrator.build({ productionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      brandId: BRAND_ID, workerId: 'fixture-worker', script: built.input.script, shotPlan, assetPlan,
      resolvedMedia: [{ assetId: videoAsset.asset_id, kind: 'video', brandId: BRAND_ID, bytes: triptych.bytes,
        contentType: 'video/mp4', mediaProbe: triptych.probe, provider: 'fixture', model: 'triptych',
        artifact: { artifactId: `brand:${BRAND_ID}:asset:${videoAsset.asset_id}`, version: 1,
          storageKey: 'fixture/triptych.mp4', contentHash: crypto.createHash('sha256').update(triptych.bytes).digest('hex') } }],
      qualityPolicy: { requireVoiceForSpokenCopy: false, requireAudio: false, requireVoiceTimingPlan: false,
        requireProviderCompatibility: true, creativePlan: { fixture: 'triptych' } } }), (error) => {
      assert.equal(error.code, 'SOURCE_QUALITY_VALIDATION_FAILED');
      assert.equal(error.details.quality.lifecycle.providerGeneration, 'PASS');
      assert.equal(error.details.quality.lifecycle.sourceTechnical, 'PASS');
      assert.equal(error.details.quality.lifecycle.sourceVisual, 'FAIL');
      assert.equal(error.details.quality.lifecycle.masterAssembly, 'BLOCKED');
      assert.equal(error.details.quality.lifecycle.humanReview, 'BLOCKED');
      assert.equal(error.details.paidRegenerationTriggered, false);
      return true;
    });
    assert.equal(renderCalls, 0, 'source visual failure must block master assembly');

    const artifactCalls = [];
    const finalFailureOrchestrator = new MasterProductionOrchestrator({
      providerGateway: { generate() { throw new Error('provider call forbidden'); } },
      artifactService: fakeArtifactService(artifactCalls),
      renderer: { async render() { return { output: Buffer.from('invalid-rendered-master'), contentType: 'video/mp4',
        probe: { width: 1080, height: 1920, fps: 30, durationMs: 5000, videoCodec: 'h264', hasAudio: false },
        provenance: { renderer: 'fixture-renderer', profile: { width: 1080, height: 1920, fps: 30 } } }; } },
      sourceQualityEvaluator: single.evaluator, finalQualityEvaluator: single.evaluator,
    });
    const finalFailure = await finalFailureOrchestrator.build({ productionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      brandId: BRAND_ID, workerId: 'fixture-worker', script: built.input.script, shotPlan, assetPlan,
      resolvedMedia: [{ assetId: videoAsset.asset_id, kind: 'video', brandId: BRAND_ID, bytes: single.bytes,
        contentType: 'video/mp4', mediaProbe: single.probe, provider: 'fixture', model: 'single',
        artifact: { artifactId: `brand:${BRAND_ID}:asset:${videoAsset.asset_id}`, version: 1,
          storageKey: 'fixture/single.mp4', contentHash: crypto.createHash('sha256').update(single.bytes).digest('hex') } }],
      qualityPolicy: { requireVoiceForSpokenCopy: false, requireAudio: false, requireVoiceTimingPlan: false,
        requireProviderCompatibility: true, creativePlan: { fixture: 'singleComposition' } } });
    assert.equal(finalFailure.quality.status, 'FAIL');
    assert.equal(finalFailure.quality.readyForHumanReview, false);
    assert(artifactCalls.some((call) => call.artifactId === `production:${finalFailure.productionId}:master`
      && call.validationStatus === 'failed'), 'failed rendered master must be preserved immutably');
    assert(artifactCalls.some((call) => call.artifactId.includes(':quality:final:evaluation')));

    const audio = new AudioQualityEvaluator().evaluate({ qualityTier: 'STANDARD', expectedDurationMs: 5000,
      mediaResults: [{ kind: 'voice', mediaProbe: { hasAudio: true, durationMs: 7656 } }] });
    assert.equal(audio.status, 'FAIL'); assert(audio.hardFailureCodes.includes(REASON_CODES.VOICEOVER_CUTOFF));
    assert.equal(classifyRejectionReason('Triptych composition and gibberish text'), 'POOR_COMPOSITION');
    assert.equal(classifyRejectionReason('Bad face and hands'), 'BAD_FACE');

    const progress = progressFor({ jobId: 'job', jobStatus: 'FAILED', status: 'FAILED', validationStatus: 'FAIL', reviewState: 'BLOCKED',
      qualityLifecycle: { preExecution: 'PASS', providerGeneration: 'PASS', sourceTechnical: 'PASS', sourceVisual: 'FAIL',
        temporalQuality: 'PASS', creativeCompliance: 'PASS', masterAssembly: 'BLOCKED', masterTechnical: 'NOT_STARTED',
        finalQuality: 'NOT_STARTED', humanReview: 'BLOCKED' } });
    assert.deepEqual(progress.map((stage) => [stage.label, stage.status]), [
      ['Pre-Execution','COMPLETED'],['Provider Generation','COMPLETED'],['Source Technical','COMPLETED'],
      ['Source Visual','FAILED'],['Temporal Quality','COMPLETED'],['Creative Compliance','COMPLETED'],
      ['Master Assembly','BLOCKED'],['Master Technical','PENDING'],['Final Quality','PENDING'],['Human Review','BLOCKED'],
    ]);
    console.log('V2.9 world-class visual quality fixtures, gates, lifecycle, paid boundary, and policies passed (provider calls 0).');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
