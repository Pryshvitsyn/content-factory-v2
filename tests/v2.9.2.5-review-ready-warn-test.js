'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SemanticEvaluationRetryService } = require('../src/v2.9/semantic-evaluation-retry');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { qualityCheck, qualityResult, REASON_CODES } = require('../src/v2.9/quality-contract');

const frameBytes = Buffer.from('review-ready-warning-frame');
const frameHash = crypto.createHash('sha256').update(frameBytes).digest('hex');
const sourceArtifact = Object.freeze({ artifactId: 'source-video', version: 1,
  storageKey: 'source-video.mp4', contentHash: 'source-video-hash' });
const evidenceArtifact = Object.freeze({ artifactId: 'source-evaluation', version: 1,
  contentHash: 'source-evaluation-hash' });
const frame = Object.freeze({ ratio: 0.5, timestampMs: 2500, analysisHash: 'analysis-1',
  artifactId: 'source-frame', artifactVersion: 1, storageKey: 'source-frame.jpg',
  contentHash: frameHash, contentType: 'image/jpeg' });

function semanticPass() {
  const semantic = qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
    code: REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT,
    status: 'PASS', qualityClass: 'SEMANTIC_VISUAL', reason: 'Brand-safety family passed.',
  })], metadata: { externalCalls: 1 } });
  return Object.freeze({
    ...qualityResult({ qualityClass: 'SOURCE_VISUAL_GATE', checks: semantic.checks,
      metadata: { semanticOnlyRetry: true } }),
    semantic,
    sampledFrames: [frame],
  });
}

function failedProduction() {
  const deterministicVisual = qualityResult({ qualityClass: 'SOURCE_VISUAL', checks: [qualityCheck({
    code: 'SOURCE_TECHNICAL_PASS', status: 'PASS', qualityClass: 'SOURCE_VISUAL', reason: 'Technical checks passed.',
  })] });
  const temporal = qualityResult({ qualityClass: 'TEMPORAL_QUALITY', checks: [qualityCheck({
    code: 'SOURCE_TEMPORAL_PASS', status: 'PASS', qualityClass: 'TEMPORAL_QUALITY', reason: 'Temporal checks passed.',
  })] });
  const semantic = qualityResult({ qualityClass: 'SEMANTIC_VISUAL', checks: [qualityCheck({
    code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE,
    status: 'FAIL', qualityClass: 'SEMANTIC_VISUAL', reason: 'Old evaluator response was malformed.', hardFailure: false,
  })] });
  return {
    id: 'production-1', workspaceId: 'workspace-1', brandId: 'brand-1', jobId: 'job-1',
    jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', details: { sourceQuality: { shots: [{
      assetId: 'operator-video-1', status: 'FAIL', deterministicVisual, temporal, semantic,
      sampledFrames: [frame], evidenceArtifact,
    }] } } },
  };
}

const input = {
  captions: { enabled: false }, voiceover: { enabled: true }, spokenCopyPolicy: { strictApprovedCopy: true },
  creativePlan: {}, script: {}, shotPlan: {}, assetPlan: { assets: [
    { asset_id: 'operator-video-1', kind: 'video', generation_requirements: { profile: 'STANDARD', aspect_ratio: '9:16' } },
    { asset_id: 'voiceover-main', kind: 'voice', generation_requirements: { text: 'Approved copy.', provider: 'openai-media', model: 'gpt-4o-mini-tts', voice: 'alloy' } },
  ] },
};

async function testSemanticServiceAcceptsReviewReadyWarn() {
  let evaluatorCalls = 0;
  let assemblyCalls = 0;
  const pass = semanticPass();
  const latestAttempt = {
    id: 'legacy-attempt-7', attempt: 7, status: 'SUCCEEDED', source_artifact: sourceArtifact,
    previous_evidence: { evidenceArtifact }, result_evidence: pass,
    evaluator_provider: 'openai', evaluator_model: 'semantic-test', recovery_phase: 'SUCCEEDED',
  };
  const attempts = [];
  const repository = {
    async inspectSchema() { return { ready: true }; },
    async latest() { return latestAttempt; },
    async start(args) { attempts.push({ type: 'start', ...args }); return { id: 'attempt-8' }; },
    async finish(args) { attempts.push({ type: 'finish', ...args }); return args; },
  };
  const executionRepository = { async get({ assetId }) {
    if (assetId === 'operator-video-1') return { asset_id: assetId, kind: 'video', status: 'SUCCEEDED',
      artifact_id: sourceArtifact.artifactId, artifact_version: sourceArtifact.version,
      artifact_storage_key: sourceArtifact.storageKey, artifact_content_hash: sourceArtifact.contentHash };
    return { asset_id: assetId, kind: 'voice', status: 'SUCCEEDED', artifact_id: 'voice', artifact_version: 1,
      artifact_storage_key: 'voice.mp3', artifact_content_hash: 'voice-hash' };
  } };
  const mediaExecutor = { repository: executionRepository,
    async loadExisting({ asset }) {
      if (asset.kind === 'video') return { assetId: asset.asset_id, kind: 'video', provider: 'replicate',
        model: 'alibaba/wan-3', artifact: sourceArtifact, bytes: Buffer.from('video') };
      return { assetId: asset.asset_id, kind: 'voice', provider: 'openai-media', model: 'gpt-4o-mini-tts',
        artifact: { artifactId: 'voice', version: 1, storageKey: 'voice.mp3', contentHash: 'voice-hash' },
        bytes: Buffer.from('voice') };
    },
    async execute() { throw new Error('No provider generation is allowed in this regression'); },
  };
  const evaluator = { semanticAdapter: { provider: 'openai', model: 'semantic-test' },
    async retrySemantic() { evaluatorCalls += 1; throw new Error('Reusable semantic PASS must prevent evaluator call'); } };
  const warningQuality = Object.freeze({
    status: 'WARN', readyForHumanReview: true,
    checks: [Object.freeze({ code: REASON_CODES.AUDIO_SEMANTIC_QA_NOT_CONFIGURED, status: 'WARN',
      reason: 'Advisory audio semantic QA is not configured.' })],
  });
  const masterOrchestrator = { async build({ semanticRecovery }) {
    assemblyCalls += 1;
    assert.equal(Buffer.isBuffer(semanticRecovery.evaluation.sampledFrames[0].jpeg), true);
    return { master: { artifact: { artifactId: 'master', version: 1, storageKey: 'master.mp4' } }, quality: warningQuality };
  } };
  const service = new SemanticEvaluationRetryService({ repository,
    storage: { async get({ key }) { assert.equal(key, frame.storageKey); return frameBytes; } },
    mediaExecutor, evaluator, masterOrchestrator });
  const recovered = await service.execute({ production: failedProduction(), input, workerId: 'test' });
  assert.equal(evaluatorCalls, 0);
  assert.equal(assemblyCalls, 1);
  assert.equal(recovered.result.quality.status, 'WARN');
  assert.equal(recovered.result.quality.readyForHumanReview, true);
  assert.equal(attempts[0].expectedSemanticCalls, 0);
  assert.equal(attempts.at(-1).status, 'SUCCEEDED');
  assert.equal(attempts.at(-1).recoveryPhase, 'SUCCEEDED');
}

async function testLiveServiceAcceptsReviewReadyWarn() {
  const queries = [];
  const db = { async query(sql) {
    queries.push(String(sql));
    if (String(sql).includes('complete-semantic-retry')) return { rows: [{ id: 'job-1' }] };
    return { rows: [] };
  } };
  const service = new LiveProductionService({
    db, rendererRouter: {}, storageRoot: '/tmp',
    artifactService: { createVersion: async () => ({}), storage: {} },
  });
  service.semanticRetryService = { async execute() { return {
    result: { quality: { status: 'WARN', readyForHumanReview: true,
      checks: [{ code: REASON_CODES.AUDIO_SEMANTIC_QA_NOT_CONFIGURED, status: 'WARN' }] },
      master: { artifact: { artifactId: 'master', version: 1, storageKey: 'master.mp4' } } },
    attemptId: 'attempt-8', assetId: 'operator-video-1', reusedVideoAssets: 1, reusedSpeechAssets: 1,
    semanticEvaluations: 0, reusedSemanticAttemptId: 'legacy-attempt-7', newSpeechGenerations: 0, newVideoGenerations: 0,
  }; } };
  const result = await service.retrySemanticEvaluation({
    production: { id: 'production-1', brandId: 'brand-1', jobId: 'job-1' }, input: {}, config: { workerId: 'test' },
  });
  assert.equal(result.validationStatus, 'WARN');
  assert(queries.some((sql) => sql.includes('complete-semantic-retry')));
}

async function main() {
  await testSemanticServiceAcceptsReviewReadyWarn();
  await testLiveServiceAcceptsReviewReadyWarn();
  console.log('V2.9.2.5 review-ready WARN semantic recovery regression passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
