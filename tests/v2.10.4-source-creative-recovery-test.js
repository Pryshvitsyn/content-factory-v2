'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildOperatorProductionInput } = require('../src/v2.7/operator-production-input');
const { ProductionCommandService } = require('../src/v2.7/production-command-service');
const { QualityRecoveryService } = require('../src/v2.10.1/quality-recovery-service');
const { V210ReferenceAwareMediaExecutor } = require('../src/v2.10/reference-aware-media');
const { SOURCE_CREATIVE_RECOVERY_INSTRUCTION } = require('../src/v2.10.4/source-creative-recovery');

const W = '10000000-0000-4000-8000-000000000001';
const B = 'a03def76-bd3d-4c8e-b00a-ec77616c5191';
const P = '067bd316-ee7c-42c8-bea3-ae61f72847b1';
const J = 'bb4aff78-a7f8-4b8b-9405-b3957644104e';
const REQUEST = '41000000-0000-4000-8000-000000000004';
const ORIGINAL_ARTIFACT = 'brand:a03def76-bd3d-4c8e-b00a-ec77616c5191:asset:video-1';
const ORIGINAL_HASH = 'e80c0ffbe5f9fb4a951113d6ab6b2e3d0acbaaed99881c467795c3a334b8e455';

function rawInput() {
  const brand = { id: B, workspaceId: W, name: 'Attune' };
  const request = { requestId: REQUEST, brandId: B, renderMode: 'QUALITY', title: 'Tune Into Her',
    objective: 'ENGAGEMENT', platform: 'Instagram Reels', targetDurationSeconds: 10, aspectRatio: '9:16',
    hook: 'A tense opening moment', coreMessage: 'Attention helps',
    creativeBrief: 'A couple moves from unresolved tension to calm attention in one apartment.',
    cta: "Don't guess. Tune in.", captionsEnabled: false, musicEnabled: false };
  const built = buildOperatorProductionInput(request, brand, { qualityProfile: { provider: 'replicate',
    model: 'alibaba/wan-3', name: 'STANDARD', resolution: '720p', capability: 'TEXT_TO_VIDEO' } });
  const raw = structuredClone(built.canonicalRawInput);
  raw.scenes[0].shots[0].asset_id = 'video-1';
  raw.creative_plan.shots[0].assetId = 'video-1';
  return raw;
}

function failedCandidate() {
  return { assetId: 'video-1', status: 'FAIL', sourceProbe: { width: 720, height: 1280, durationMs: 5038 },
    deterministicVisual: { status: 'PASS', checks: [{ code: 'SOURCE_MEDIA_READABLE', status: 'PASS' }] },
    temporal: { status: 'PASS', checks: [{ code: 'TEMPORAL_STABILITY', status: 'PASS' }] },
    semantic: { status: 'FAIL', checks: [{ code: 'CREATIVE_PLAN_MISMATCH', status: 'FAIL',
      reason: 'The couple are already embracing and holding hands in the opening frame.' }],
    metadata: { provider: 'openai', model: 'mock-semantic', externalCalls: 1 } } };
}

function failedProduction() {
  const raw = rawInput();
  return { id: P, brandId: B, jobId: J, renderMode: 'QUALITY', jobStatus: 'FAILED',
    jobPayload: { canonicalRawInput: raw, canonicalRequest: { requestId: REQUEST, brandId: B } },
    jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', details: {
      sourceQuality: { status: 'FAIL', shots: [failedCandidate()] } } } };
}

async function classificationTest() {
  let semanticFactoryCalls = 0;
  const production = failedProduction();
  const repository = { async getCommandProduction() { return production; },
    async executionSafety() { return { ambiguousExecutions: 0 }; },
    async countCreativeRecoveries() { return 0; }, async latestSuccessfulCreativeRecovery() { return null; } };
  const service = new QualityRecoveryService({ repository, storage: {}, commandService: {},
    semanticAdapterFactory() { semanticFactoryCalls += 1; throw new Error('same failed bytes must not be re-evaluated'); } });
  const plan = await service.inspect({ productionId: P, brandId: B, production });
  assert.equal(plan.action, 'REGENERATE_SHOT');
  assert.equal(plan.recoveryKind, 'SOURCE_CREATIVE');
  assert.notEqual(plan.action, 'RE_EVALUATE_EXISTING_ASSET');
  assert.equal(plan.newVideoGenerations, 1);
  assert.equal(plan.semanticEvaluations, 1);
  assert.equal(plan.maximumExternalCalls, 2);
  assert.equal(plan.existingFailedArtifact, 'PRESERVED_IMMUTABLY');
  assert.equal(plan.sameProduction, true);
  assert.equal(plan.autoPublish, false);
  assert.equal(semanticFactoryCalls, 0, 'classification/preflight performs zero external calls');
  await assert.rejects(() => service.recover({ productionId: P, brandId: B, confirmation: true }),
    (error) => error.code === 'QUALITY_RECOVERY_REGENERATION_REQUIRED');
  assert.equal(semanticFactoryCalls, 0, 'generic semantic recovery never receives the rejected bytes');
  repository.countCreativeRecoveries = async () => 1;
  const bounded = await service.inspect({ productionId: P, brandId: B, production });
  assert.equal(bounded.eligible, false); assert.equal(bounded.automaticCreativeAttemptsMaximum, 1);
}

function commandHarness({ qualityResult }) {
  const source = failedProduction();
  let scheduled = null; let preparedInput = null; let providerCalls = 0; let evaluatorCalls = 0;
  let completion = null; let failure = null;
  const repository = { db: {}, async executionSafety() { return { ambiguousExecutions: 0 }; },
    async latestShotRevision() { return null; }, async nextShotRevision() { return 1; },
    async countCreativeRecoveries() { return 0; }, async getShotRegenerationByRequest() { return null; },
    async ensureShotRegeneration(record) { return { id: 'regen-1', status: 'PREPARED', ...record }; },
    async claimShotRegeneration() { return { id: 'regen-1' }; },
    async sourceMediaExecution() { return { artifact_id: ORIGINAL_ARTIFACT, artifact_version: 1,
      artifact_storage_key: 'immutable/video-1.mp4', artifact_content_hash: ORIGINAL_HASH }; },
    async completeSourceRecovery(id, value) { completion = { id, ...value }; },
    async failShotRegeneration(id, error) { failure = { id, error }; } };
  const command = new ProductionCommandService({ repository, storage: {}, scheduler(task) { scheduled = task; },
    providers: [{ capability: 'VIDEO', provider: 'replicate', configured: true, model: 'alibaba/wan-3' }] });
  command.stored = async () => structuredClone(source);
  command.assertCapability = () => {};
  command.runtime = (input, options = {}) => ({ config: { workerId: 'mock-worker' }, service: {
    async prepareRevision() { preparedInput = input; return { input, brand: { workspaceId: W }, plan: {
      expectedVideoGenerations: 1, expectedAudioGenerations: 0, expectedPaidProviderCalls: 1,
      expectedSemanticEvaluations: 1, expectedQualityEvaluatorCalls: 1, provider: 'replicate',
      model: 'alibaba/wan-3', resolution: '720p', semanticEvaluatorProvider: 'mock', semanticEvaluatorModel: 'mock-v1' } }; } },
  mediaExecutor: { async execute({ asset }) { providerCalls += 1;
    assert.match(asset.generation_requirements.prompt, /Opening frame must show clear physical separation/);
    assert.match(asset.generation_requirements.prompt, /No embrace, cuddling/);
    return { bytes: Buffer.from('fresh-replacement-bytes'), contentType: 'video/mp4',
      artifact: { artifactId: `brand:${B}:asset:${asset.asset_id}`, version: 2,
        storageKey: `immutable/${asset.asset_id}.mp4`, contentHash: crypto.createHash('sha256').update('fresh-replacement-bytes').digest('hex') },
      provider: 'replicate', model: 'alibaba/wan-3', requestId: 'mock-provider-request-2',
      mediaProbe: { width: 720, height: 1280, durationMs: 5000 }, provenance: { seed: 123 } }; } },
  visualQualityEvaluator: { async evaluate({ media, evaluationClass, semanticEvaluationRequired }) {
    evaluatorCalls += 1; assert.equal(media.bytes.toString(), 'fresh-replacement-bytes');
    assert.equal(evaluationClass, 'SOURCE_CREATIVE_RECOVERY'); assert.equal(semanticEvaluationRequired, true);
    return qualityResult;
  } } });
  return { command, repository, source, state: () => ({ scheduled, preparedInput, providerCalls, evaluatorCalls,
    completion, failure, options: null }) };
}

async function executionTest() {
  const pass = commandHarness({ qualityResult: { status: 'PASS', disposition: 'ACCEPT',
    deterministicVisual: { status: 'PASS' }, temporal: { status: 'PASS' }, semantic: { status: 'PASS' } } });
  const preflight = await pass.command.preflightShotRegeneration({ productionId: P, brandId: B,
    shotId: 'operator-shot-1', requestId: REQUEST, recoveryReason: 'SOURCE_CREATIVE' });
  assert.equal(preflight.expectedVideoGenerations, 1); assert.equal(preflight.expectedSemanticEvaluations, 1);
  assert.equal(preflight.maximumExternalCalls, 2); assert.equal(preflight.providerCalls, 0);
  assert.equal(preflight.sameProduction, true); assert.equal(preflight.autoPublish, false);
  assert.match(pass.state().preparedInput.assetPlan.assets.find((asset) => asset.asset_id === preflight.replacementAssetId)
    .generation_requirements.prompt, new RegExp(SOURCE_CREATIVE_RECOVERY_INSTRUCTION.slice(0, 70)));
  assert.equal(pass.state().providerCalls, 0, 'preflight has no provider call');

  const accepted = await pass.command.regenerateShot({ productionId: P, brandId: B, shotId: 'operator-shot-1',
    requestId: REQUEST, recoveryReason: 'SOURCE_CREATIVE', preflightId: preflight.preflightId, confirmation: true });
  assert.equal(accepted.recoveryKind, 'SOURCE_CREATIVE');
  assert.equal(pass.state().providerCalls, 0, 'downstream work remains blocked until scheduled replacement executes');
  await pass.state().scheduled();
  const done = pass.state();
  assert.equal(done.providerCalls, 1); assert.equal(done.evaluatorCalls, 1);
  assert.equal(done.completion.productionId, P); assert.equal(done.completion.jobId, J);
  assert.equal(done.completion.recoveryKind, 'SOURCE_CREATIVE');
  assert.equal(done.completion.result.sourceAssetId, 'video-1');
  assert.notEqual(done.completion.result.replacementAssetId, 'video-1');
  assert.equal(done.completion.result.supersedesArtifact.artifactId, ORIGINAL_ARTIFACT);
  assert.equal(done.completion.result.supersedesArtifact.contentHash, ORIGINAL_HASH);
  assert.equal(done.failure, null);

  const fail = commandHarness({ qualityResult: { status: 'FAIL', disposition: 'BLOCK', semantic: { status: 'FAIL',
    checks: [{ code: 'CREATIVE_PLAN_MISMATCH', status: 'FAIL' }] } } });
  const failedPreflight = await fail.command.preflightShotRegeneration({ productionId: P, brandId: B,
    shotId: 'operator-shot-1', requestId: REQUEST, recoveryReason: 'SOURCE_CREATIVE' });
  await fail.command.regenerateShot({ productionId: P, brandId: B, shotId: 'operator-shot-1', requestId: REQUEST,
    recoveryReason: 'SOURCE_CREATIVE', preflightId: failedPreflight.preflightId, confirmation: true });
  await assert.rejects(() => fail.state().scheduled(), (error) => error.code === 'SOURCE_QUALITY_VALIDATION_FAILED');
  assert.equal(fail.state().providerCalls, 1); assert.equal(fail.state().evaluatorCalls, 1);
  assert.equal(fail.state().completion, null, 'failed replacement cannot resume the job');
  assert.equal(fail.state().failure.error.details.quality.semantic.checks[0].code, 'CREATIVE_PLAN_MISMATCH');
}

async function acceptedReplacementTest() {
  const replacementBytes = Buffer.from('accepted-creative-replacement');
  let delegateCalls = [];
  const replacement = { id: 'media-replacement', status: 'SUCCEEDED', source_asset_id: 'video-1',
    replacement_asset_id: 'video-1-rev-new', revision_no: 1, retry_reason: 'CREATIVE_PLAN_MISMATCH',
    recovery_kind: 'SOURCE_CREATIVE', artifact_id: 'replacement-artifact', artifact_version: 2,
    artifact_storage_key: 'immutable/replacement.mp4', artifact_content_hash: crypto.createHash('sha256').update(replacementBytes).digest('hex'),
    content_type: 'video/mp4', media_probe: { width: 720, height: 1280 }, provider: 'replicate', model: 'alibaba/wan-3' };
  const repository = { async latestSucceededReplacement({ assetId }) { return assetId === 'video-1' ? replacement : null; } };
  const delegate = { repository, artifactService: {}, mediaInspector: {}, assetRepository: {},
    selection() { return {}; }, identities() { return {}; },
    async execute({ asset }) { delegateCalls.push(asset.asset_id); return { assetId: asset.asset_id, bytes: Buffer.from(asset.asset_id),
      artifact: {}, provenance: {} }; }, async loadExisting(args) { return this.execute(args); } };
  const executor = new V210ReferenceAwareMediaExecutor({ delegate,
    storage: { async get({ key }) { assert.equal(key, replacement.artifact_storage_key); return replacementBytes; } } });
  const reused = await executor.execute({ productionId: P, brandId: B, workspaceId: W,
    asset: { asset_id: 'video-1', kind: 'video', generation_requirements: {} } });
  assert.equal(reused.bytes.toString(), replacementBytes.toString());
  assert.equal(reused.provenance.recoveryKind, 'SOURCE_CREATIVE');
  await executor.execute({ productionId: P, brandId: B, workspaceId: W,
    asset: { asset_id: 'video-2', kind: 'video', generation_requirements: {} } });
  await executor.execute({ productionId: P, brandId: B, workspaceId: W,
    asset: { asset_id: 'voiceover-main', kind: 'voice', generation_requirements: {} } });
  assert.deepEqual(delegateCalls, ['video-2','voiceover-main'], 'resume reuses accepted shot 1 and executes only missing work');
}

function dashboardContractTest() {
  const ui = fs.readFileSync(path.join(__dirname, '../apps/dashboard/client/src/QualityRecoveryConsole.jsx'), 'utf8');
  const wiring = fs.readFileSync(path.join(__dirname, '../apps/dashboard/server/index.js'), 'utf8');
  assert.match(ui, /CREATIVE PLAN MISMATCH/);
  assert.match(ui, /SOURCE_CREATIVE/);
  assert.match(ui, /Maximum replacement external calls/);
  assert.match(ui, /Opening frame must show clear physical separation/);
  assert.match(ui, /CONTINUE SAME EXECUTION/);
  assert.match(wiring, /SOURCE_CREATIVE/);
  assert.doesNotMatch(ui, /CREATIVE PLAN MISMATCH[\s\S]{0,160}RE-EVALUATE EXISTING ASSET/);
}

async function main() {
  await classificationTest();
  await executionTest();
  await acceptedReplacementTest();
  dashboardContractTest();
  console.log('V2.10.4 source creative recovery classification, bounded replacement, fresh validation, immutable lineage, and remaining-only resume passed; real external calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
