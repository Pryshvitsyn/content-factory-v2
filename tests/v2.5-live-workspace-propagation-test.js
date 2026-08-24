'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { DurableMediaExecutor } = require('../src/v2.5/durable-media-executor');
const { buildProductionInput } = require('../src/v2.5/production-input');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTION_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

class FakeDb {
  constructor(brandId) {
    this.brand = { id: brandId, name: 'Attune Test', workspaceId: WORKSPACE_ID };
    this.production = null;
    this.job = null;
    this.review = null;
  }

  async query(sql, values = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('v2.4:database-health')) return { rows: [{}] };
    if (sql.includes('v2.4:get-brand')) return { rows: values[0] === this.brand.id ? [this.brand] : [] };
    if (sql.includes('v2.4:inspect-existing')) return { rows: [] };
    if (sql.includes('v2.4:create-production')) {
      this.production ||= { id: PRODUCTION_ID, workspace_id: values[0], brand_id: values[1], name: values[2],
        status: 'DRAFT', objective: values[3], metadata: JSON.parse(values[4]) };
      return { rows: [] };
    }
    if (sql.includes('v2.4:get-production-for-run')) return { rows: [this.production] };
    if (sql.includes('v2.4:create-live-job')) {
      this.job ||= { id: JOB_ID, production_id: PRODUCTION_ID, status: 'QUEUED', payload: JSON.parse(values[2]), result: {} };
      return { rows: [] };
    }
    if (sql.includes('v2.4:get-live-job')) return { rows: [this.job] };
    if (sql.includes('v2.4:claim-live-job')) {
      this.job.status = 'RUNNING'; this.job.worker_id = values[1];
      return { rows: [this.job] };
    }
    if (sql.includes('v2.4:mark-provider-boundary')) {
      this.job.payload = { ...this.job.payload, ...JSON.parse(values[3]) };
      return { rows: [this.job] };
    }
    if (sql.includes('v2.4:get-pending-review')) return { rows: this.review ? [this.review] : [] };
    if (sql.includes('v2.4:complete-live-job')) {
      this.job.status = 'COMPLETED'; this.job.result = JSON.parse(values[3]);
      return { rows: [this.job] };
    }
    if (sql.includes('v2.4:fail-live-job')) {
      this.job.status = values[4];
      return { rows: [this.job] };
    }
    if (sql.startsWith('UPDATE v2_1.productions')) {
      this.production.status = sql.includes("status='COMPLETED'") ? 'COMPLETED' : sql.includes("status='FAILED'") ? 'FAILED' : 'RUNNING';
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class MemoryMediaRepository {
  constructor(workspaceIds) { this.workspaceIds = workspaceIds; this.rows = new Map(); this.counter = 0; }
  async ensure(args) {
    this.workspaceIds.push(args.workspaceId);
    let row = this.rows.get(args.asset.asset_id);
    if (!row) {
      row = { id: `media-${++this.counter}`, status: 'NOT_STARTED', provider: args.provider, model: args.model,
        provider_request_id: null, media_probe: {}, provenance: {} };
      this.rows.set(args.asset.asset_id, row);
    }
    return row;
  }
  async claim({ id, workerId }) { const row = this.byId(id); row.status = 'RUNNING'; row.worker_id = workerId; return row; }
  async markBoundary({ id }) { const row = this.byId(id); row.status = 'MAY_HAVE_STARTED'; return row; }
  async recordProviderRequest({ id, requestId, providerStatus }) {
    const row = this.byId(id); row.provider_request_id = requestId; row.provider_status = providerStatus; return row;
  }
  async adopt({ id, artifact, media, probe }) {
    const row = this.byId(id); Object.assign(row, { status: 'SUCCEEDED', artifact_id: artifact.artifactId,
      provider_request_id: media.requestId, media_probe: probe }); return row;
  }
  async markFailure({ id }) { this.byId(id).status = 'RETRYABLE'; }
  byId(id) { return [...this.rows.values()].find((row) => row.id === id); }
}

async function main() {
  const input = buildProductionInput(JSON.parse(fs.readFileSync(
    path.resolve('config/productions/attune-dont-guess-tune-in.json'), 'utf8',
  )));
  assert.equal(input.workspaceId, undefined, 'operator input must not provide canonical workspace ownership');

  const db = new FakeDb(input.brandId);
  const executorWorkspaceIds = [];
  const repository = new MemoryMediaRepository(executorWorkspaceIds);
  let mockProviderCalls = 0;
  let artifactVersion = 0;
  const artifactService = {
    storage: {},
    async getVersionByIdempotency() { return null; },
    async createVersion(args) {
      artifactVersion += 1;
      return { artifactId: args.artifactId, version: artifactVersion, storageKey: `mock/${artifactVersion}`,
        contentHash: `mock-hash-${artifactVersion}`, content: args.content };
    },
  };
  const providerGateway = {
    select() { return { provider: 'mock-provider', model: 'mock-model' }; },
    async generate(request) {
      mockProviderCalls += 1;
      const requestId = `mock-request-${mockProviderCalls}`;
      await request.onProviderRequest?.({ requestId, status: 'processing' });
      const isVideo = request.capability === 'video-generation';
      return { output: Buffer.from(`mock-media-${mockProviderCalls}`), contentType: isVideo ? 'video/mp4' : 'audio/mpeg',
        requestId, provider: 'mock-provider', model: 'mock-model', provenance: { provider: 'mock-provider', model: 'mock-model' } };
    },
  };
  const mediaExecutor = new DurableMediaExecutor({ repository, providerGateway, artifactService,
    mediaInspector: { async inspect({ expectedDurationMs }) { return { status: 'PASS', durationMs: expectedDurationMs || 10000 }; } } });
  const masterOrchestrator = new MasterProductionOrchestrator({
    providerGateway, artifactService, mediaExecutor,
    renderer: { async render() { return { output: Buffer.from('mock-master'), contentType: 'video/mp4',
      probe: { width: 1080, height: 1920, fps: 30, durationMs: 10000, videoCodec: 'h264', hasAudio: true },
      provenance: { renderer: 'mock-renderer' } }; } },
    reviewService: { async registerMasterForReview() { db.review = { id: 'review-1', status: 'AWAITING_HUMAN_APPROVAL' }; } },
  });
  let masterWorkspaceId = null;
  const build = masterOrchestrator.build.bind(masterOrchestrator);
  masterOrchestrator.build = async (request) => { masterWorkspaceId = request.workspaceId; return build(request); };

  const service = new LiveProductionService({
    db, masterOrchestrator, artifactService, mediaExecutionRepository: {
      async inspectSchema() {}, async verifyTransactionalPlan() { return { passed: true, persisted: false }; }, async list() { return []; },
    },
    storageRoot: '/tmp/mock-storage', storageValidator: async () => {},
    schemaInspector: async () => ({ compatible: true, counts: { error: 0, warn: 0 }, issues: [] }),
    transactionProbe: async () => ({ passed: true, persisted: false }), storageProbe: async () => ({ passed: true, persisted: false }),
    logger: { info() {} },
  });
  const result = await service.run({ input, config: { live: true, provider: 'replicate',
    model: 'wan-video/wan-2.2-t2v-fast', workerId: 'v2.5-workspace-regression' } });

  assert.equal(result.validationStatus, 'PASS');
  assert.equal(masterWorkspaceId, WORKSPACE_ID, 'live path must pass prepared canonical workspaceId to MasterProductionOrchestrator');
  assert.equal(executorWorkspaceIds.length, input.assetPlan.assets.length);
  assert.ok(executorWorkspaceIds.every((workspaceId) => workspaceId === WORKSPACE_ID),
    'MasterProductionOrchestrator must pass canonical workspaceId to every DurableMediaExecutor call');
  assert.equal(mockProviderCalls, input.assetPlan.assets.length, 'all provider invocations must remain in-memory mocks');
  console.log('V2.5 live workspace propagation regression passed (providers mocked; zero external calls).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
