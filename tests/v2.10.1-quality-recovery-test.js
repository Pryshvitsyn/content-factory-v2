'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { FfprobeMediaInspector } = require('../src/v2.5/media-validator');
const { VisualQualityEvaluator } = require('../src/v2.9/visual-quality-evaluator');
const { FunctionSemanticVisualEvaluatorAdapter } = require('../src/v2.9/semantic-visual-evaluator');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { QualityRecoveryService } = require('../src/v2.10.1/quality-recovery-service');
const { generateFixtureDirectory } = require('./fixtures/v2.9/generate-visual-fixtures');

const P = '41000000-0000-4000-8000-000000000001';
const B = '41000000-0000-4000-8000-000000000002';
const J = '41000000-0000-4000-8000-000000000003';

function semanticAdapter() {
  return new FunctionSemanticVisualEvaluatorAdapter({ provider: 'openai', model: 'gpt-test', estimatedCallsPerEvaluation: 0,
    evaluate: async ({ qualityTier }) => qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier: qualityTier,
      checks: [qualityCheck({ code: REASON_CODES.SINGLE_COHERENT_COMPOSITION, status: 'PASS',
        qualityClass: 'SEMANTIC_VISUAL', confidence: 0.99, reason: 'One coherent composition.' })],
      metadata: { provider: 'openai', model: 'gpt-test', externalCalls: 1, requestId: 'semantic-original' } }),
    evaluateContinuity: async ({ qualityTier }) => qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier: qualityTier,
      checks: [qualityCheck({ code: 'CONTINUITY_NOT_APPLICABLE', status: 'PASS', qualityClass: 'CONTINUITY_QUALITY',
        reason: 'Single shot.' })], metadata: { externalCalls: 0 } }),
  });
}

class FakeRepository {
  constructor(production, mediaExecution) {
    this.production = production;
    this.mediaExecution = mediaExecution;
    this.db = {
      connect: async () => ({
        query: this.query.bind(this),
        release() {},
      }),
    };
  }

  async getCommandProduction(id, brandId) {
    return id === this.production.id && brandId === this.production.brandId ? structuredClone(this.production) : null;
  }

  async executionSafety() { return { ambiguousExecutions: 0, actualProviderCalls: 1 }; }

  async semanticRetryMediaExecutions() { return [structuredClone(this.mediaExecution)]; }

  async query(sql, params = []) {
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('SELECT id,status,error,payload FROM v2_1.jobs')) {
      return { rows: [{ id: this.production.jobId, status: this.production.jobStatus,
        error: structuredClone(this.production.jobError), payload: structuredClone(this.production.jobPayload) }] };
    }
    if (sql.includes('UPDATE v2_1.jobs SET status=$3')) {
      const [, , status, errorJson, recoveryJson] = params;
      this.production.jobStatus = status;
      this.production.jobError = JSON.parse(errorJson);
      this.production.jobPayload = { ...this.production.jobPayload, qualityRecovery: JSON.parse(recoveryJson) };
      return { rows: [{ id: this.production.jobId, status, error: this.production.jobError,
        payload: this.production.jobPayload }] };
    }
    throw new Error(`Unexpected SQL in V2.10.1 quality recovery test: ${sql}`);
  }
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-v2101-recovery-'));
  try {
    generateFixtureDirectory(directory);
    const sourceBytes = await fs.readFile(path.join(directory, 'singleComposition.mp4'));
    const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
    const probe = await new FfprobeMediaInspector().inspect({ bytes: sourceBytes, contentType: 'video/mp4', kind: 'video' });
    const first = await new VisualQualityEvaluator({ semanticAdapter: semanticAdapter() }).evaluate({
      media: { bytes: sourceBytes, contentType: 'video/mp4', mediaProbe: probe },
      expectedAspectRatio: '9:16', qualityTier: 'STANDARD', provider: 'replicate', model: 'alibaba/wan-3',
      generationSettings: { profile: 'STANDARD' }, creativePlan: { fixture: 'singleComposition' },
    });
    const candidate = Object.freeze({
      assetId: 'video-1', shotIds: ['shot-1'], provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD',
      status: 'FAIL', score: 0, sourceProbe: probe, generationSettings: { profile: 'STANDARD' },
      sampledFrames: first.sampledFrames.map((frame) => ({ ratio: frame.ratio, timestampMs: frame.timestampMs,
        analysisHash: frame.analysisHash })),
      deterministicVisual: { status: 'FAIL', checks: [{ code: 'SPLIT_SCREEN_DETECTED', status: 'FAIL' }] },
      temporal: first.temporal,
      semantic: Object.freeze({ ...first.semantic, metadata: Object.freeze({ ...first.semantic.metadata,
        provider: 'openai', model: 'gpt-test', externalCalls: 1,
        sampledFrameHashes: first.sampledFrames.map((frame) => frame.analysisHash),
        sampledFrameTimestampsMs: first.sampledFrames.map((frame) => frame.timestampMs) }) }),
      evidenceArtifact: { artifactId: 'old-evidence', version: 1, contentHash: 'old-evidence-hash' },
      metadata: { evaluatorVersion: 'v2.9' },
    });
    const oldSourceQuality = Object.freeze({ status: 'FAIL', score: 0, shots: [candidate],
      deterministicVisual: candidate.deterministicVisual, temporal: candidate.temporal, semantic: candidate.semantic });
    const production = {
      id: P, brandId: B, jobId: J, jobStatus: 'FAILED',
      jobPayload: { canonicalRawInput: { aspect_ratio: '9:16', creative_plan: { shots: [{ shotId: 'shot-1', assetId: 'video-1' }] },
        quality_video_profile: { name: 'STANDARD' }, visual_style: { avoid: [] } } },
      jobError: { code: 'SOURCE_QUALITY_VALIDATION_FAILED', message: 'old false positive',
        details: { sourceQuality: oldSourceQuality, quality: { status: 'FAIL', score: 0,
          lifecycle: { sourceVisual: 'FAIL', masterAssembly: 'BLOCKED', humanReview: 'BLOCKED' },
          metadata: { externalCallAccounting: { semanticVisualEvaluations: 1, sourceSemanticEvaluations: 1,
            finalSemanticEvaluations: 0, continuityEvaluations: 0, totalEvaluatorCalls: 1 } } } } },
    };

    const storage = new FilesystemStorageAdapter({ root: path.join(directory, 'storage') });
    const sourceKey = 'paid/video-1.mp4';
    await storage.put({ key: sourceKey, bytes: sourceBytes, metadata: { source: 'fixture' } });
    const mediaExecution = { asset_id: 'video-1', status: 'SUCCEEDED', artifact_id: `brand:${B}:asset:video-1`,
      artifact_version: 1, artifact_storage_key: sourceKey, artifact_content_hash: sourceHash };
    const repository = new FakeRepository(production, mediaExecution);
    let delegatedSemanticCalls = 0;
    const service = new QualityRecoveryService({ repository, storage, commandService: {},
      env: { SEMANTIC_VISUAL_PROVIDER: 'openai', SEMANTIC_VISUAL_MODEL: 'gpt-test' },
      semanticAdapterFactory: () => ({ provider: 'openai', model: 'gpt-test', configured: true,
        paidExecutionAuthorized: true,
        async evaluate() { delegatedSemanticCalls += 1; throw new Error('Reusable semantic evidence must prevent external evaluator call'); },
        async evaluateContinuity() { throw new Error('not used'); } }),
    });

    const plan = await service.preflight({ productionId: P, brandId: B });
    assert.equal(plan.eligible, true);
    assert.equal(plan.action, 'RE_EVALUATE_EXISTING_ASSET');
    assert.equal(plan.existingMedia, 'REUSED');
    assert.equal(plan.videoRegenerations, 0);
    assert.equal(plan.newVideoGenerations, 0);
    assert.equal(plan.semanticEvidence, 'REUSED');
    assert.equal(plan.semanticEvaluations, 0);
    assert.equal(plan.expectedExternalCalls, 0);

    const recovered = await service.recover({ productionId: P, brandId: B, confirmation: true });
    assert.equal(recovered.accepted, true);
    assert.equal(recovered.videoRegenerations, 0);
    assert.equal(recovered.semanticExternalCalls, 0);
    assert.equal(recovered.semanticEvidenceReused, true);
    assert.equal(recovered.nextAction, 'CONTINUE_SAME_EXECUTION');
    assert(['ACCEPT','REVIEW'].includes(recovered.disposition));
    assert.equal(repository.production.jobStatus, 'RETRYING');
    assert.equal(repository.production.jobPayload.qualityRecovery.status, 'SUCCEEDED');
    assert.equal(repository.production.jobError.code, 'QUALITY_EVIDENCE_RECOVERED');
    assert.equal(repository.production.jobError.details.paidRegenerationTriggered, false);
    assert.equal(delegatedSemanticCalls, 0);
    assert.equal(crypto.createHash('sha256').update(await storage.get({ key: sourceKey })).digest('hex'), sourceHash,
      'paid source content hash must remain unchanged');

    const repeated = await service.recover({ productionId: P, brandId: B, confirmation: true });
    assert.equal(repeated.reused, true);
    assert.equal(repeated.videoRegenerations, 0);
    assert.equal(delegatedSemanticCalls, 0);

    console.log('V2.10.1 immutable quality recovery certified: video regeneration = 0, semantic reuse = 0 calls, repeated recovery idempotent.');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
