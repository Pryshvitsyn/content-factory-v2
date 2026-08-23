'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { DurableMediaExecutor } = require('../src/v2.5/durable-media-executor');

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BRAND_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCTION_ID = '33333333-3333-4333-8333-333333333333';

class MemoryRepository {
  constructor() { this.rows = new Map(); this.counter = 0; this.db = {}; }
  async ensure(args) {
    let row = this.rows.get(args.asset.asset_id);
    if (!row) {
      row = { id: `execution-${++this.counter}`, workspace_id: args.workspaceId, brand_id: args.brandId,
        production_id: args.productionId, asset_id: args.asset.asset_id, kind: args.asset.kind,
        input_fingerprint: args.fingerprint, idempotency_key: args.idempotencyKey,
        provider: args.provider, model: args.model, status: 'NOT_STARTED', media_probe: {}, provenance: {} };
      this.rows.set(args.asset.asset_id, row);
    }
    return row;
  }
  async claim({ id, workerId }) {
    const row = [...this.rows.values()].find((item) => item.id === id);
    if (!['NOT_STARTED','RETRYABLE'].includes(row.status)) return null;
    row.status = 'RUNNING'; row.worker_id = workerId; return row;
  }
  async markBoundary({ id }) { const row = [...this.rows.values()].find((item) => item.id === id); row.status = 'MAY_HAVE_STARTED'; return row; }
  async recordProviderRequest({ id, requestId, providerStatus }) {
    const row = [...this.rows.values()].find((item) => item.id === id);
    row.provider_request_id = requestId; row.provider_status = providerStatus; return row;
  }
  async adopt({ id, artifact, media, probe }) {
    const row = [...this.rows.values()].find((item) => item.id === id);
    Object.assign(row, { status: 'SUCCEEDED', worker_id: null, artifact_id: artifact.artifactId,
      artifact_version: artifact.version, artifact_storage_key: artifact.storageKey,
      artifact_content_hash: artifact.contentHash, content_type: media.contentType,
      provider_request_id: media.requestId || row.provider_request_id, media_probe: probe, provenance: media.provenance });
    return row;
  }
  async markFailure({ id, boundaryCrossed, terminal }) {
    const row = [...this.rows.values()].find((item) => item.id === id);
    row.status = terminal ? 'FAILED' : boundaryCrossed ? 'NEEDS_RECONCILIATION' : 'RETRYABLE';
  }
}

function asset(assetId) {
  return { asset_id: assetId, kind: 'video', description: 'synthetic video', source_preference: 'generate',
    generation_requirements: { provider: 'mock-video', model: 'mock-v1', target_clip_duration_ms: 3000,
      temporal: { startMs: 0, endMs: 3000, durationMs: 3000 } }, required_for_shots: ['shot-1'] };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-v25-durable-'));
  try {
    const repository = new MemoryRepository();
    let generations = 0; let recoveries = 0; let registered = 0;
    const gateway = {
      select: () => ({ provider: 'mock-video', model: 'mock-v1' }),
      async generate(request) {
        generations += 1;
        await request.onProviderRequest({ requestId: `prediction-${generations}`, status: 'processing' });
        return { output: Buffer.from(`video-${generations}`), contentType: 'video/mp4', requestId: `prediction-${generations}`,
          provenance: { provider: 'mock-video', model: 'mock-v1', predictionId: `prediction-${generations}` } };
      },
      async recover({ requestId }) {
        recoveries += 1;
        return { output: Buffer.from(`recovered-${requestId}`), contentType: 'video/mp4', requestId,
          provider: 'mock-video', model: 'mock-v1', provenance: { predictionId: requestId, recovery: true } };
      },
    };
    const executor = new DurableMediaExecutor({ repository, providerGateway: gateway,
      artifactService: new ArtifactService({ storage: new FilesystemStorageAdapter({ root }) }),
      mediaInspector: { async inspect() { return { status: 'PASS', size: 9, durationMs: 3000, videoCodec: 'h264', hasAudio: false }; } },
      assetRepository: { async registerResolved() { registered += 1; } } });

    const first = await executor.execute({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID, workerId: 'worker-1', asset: asset('video-1') });
    assert.equal(first.requestId, 'prediction-1');
    assert.equal(repository.rows.get('video-1').status, 'SUCCEEDED');
    const duplicate = await executor.execute({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID, workerId: 'worker-2', asset: asset('video-1') });
    assert.equal(duplicate.provenance.source, 'immutable-artifact-cache');
    assert.equal(generations, 1, 'same per-asset identity must never generate twice');

    const ambiguous = await repository.ensure({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID,
      asset: asset('video-ambiguous'), fingerprint: executor.identities({ brandId: BRAND_ID, productionId: PRODUCTION_ID, asset: asset('video-ambiguous') }).fingerprint,
      idempotencyKey: executor.identities({ brandId: BRAND_ID, productionId: PRODUCTION_ID, asset: asset('video-ambiguous') }).idempotencyKey,
      provider: 'mock-video', model: 'mock-v1' });
    ambiguous.status = 'NEEDS_RECONCILIATION';
    await assert.rejects(() => executor.execute({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID,
      workerId: 'worker-3', asset: asset('video-ambiguous') }), (error) => error.code === 'MEDIA_PROVIDER_STATE_UNRESOLVED');
    assert.equal(generations, 1, 'ambiguous provider state must fail closed without another generation');

    const recoverableAsset = asset('video-recoverable');
    const recoverableIds = executor.identities({ brandId: BRAND_ID, productionId: PRODUCTION_ID, asset: recoverableAsset });
    const recoverable = await repository.ensure({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID,
      asset: recoverableAsset, fingerprint: recoverableIds.fingerprint, idempotencyKey: recoverableIds.idempotencyKey,
      provider: 'mock-video', model: 'mock-v1' });
    recoverable.status = 'NEEDS_RECONCILIATION'; recoverable.provider_request_id = 'prediction-existing';
    const recovered = await executor.execute({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: PRODUCTION_ID,
      workerId: 'worker-4', asset: recoverableAsset });
    assert.equal(recovered.requestId, 'prediction-existing');
    assert.equal(recoveries, 1); assert.equal(generations, 1, 'reconciliation must poll existing request, not POST another');
    assert.equal(registered, 3, 'generated, cached, and reconciled assets remain visible in the registry');
    console.log('V2.5 durable per-asset idempotency and crash/reconciliation contract passed (provider calls mocked).');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
