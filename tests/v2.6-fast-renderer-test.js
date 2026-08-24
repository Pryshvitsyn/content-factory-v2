'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { runProcess } = require('../src/v2.1/ffmpeg-master-renderer');
const { FfprobeMediaInspector } = require('../src/v2.5/media-validator');
const { DurableFastRenderer } = require('../src/v2.6/durable-fast-renderer');

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BRAND_ID = '22222222-2222-4222-8222-222222222222';

class MemoryRepository {
  constructor() { this.rows = new Map(); this.counter = 0; }
  key(args) { return `${args.productionId}:${args.renderer}`; }
  async ensure(args) {
    const key = this.key(args); let row = this.rows.get(key);
    if (!row) {
      row = { id: `fast-${++this.counter}`, workspace_id: args.workspaceId, brand_id: args.brandId,
        production_id: args.productionId, renderer: args.renderer, renderer_version: args.rendererVersion,
        input_fingerprint: args.inputFingerprint, idempotency_key: args.idempotencyKey, status: 'NOT_STARTED',
        media_probe: {}, provenance: {}, cost: { status: 'unknown' } };
      this.rows.set(key, row);
    }
    if (row.workspace_id !== args.workspaceId || row.brand_id !== args.brandId || row.input_fingerprint !== args.inputFingerprint) {
      const error = new Error('identity conflict'); error.code = 'FAST_RENDER_IDENTITY_CONFLICT'; throw error;
    }
    return row;
  }
  async claim({ id, workerId }) { const row = this.byId(id); if (!['NOT_STARTED','RETRYABLE'].includes(row.status)) return null;
    row.status = 'RUNNING'; row.worker_id = workerId; return row; }
  async markBoundary({ id }) { const row = this.byId(id); row.status = 'MAY_HAVE_STARTED'; return row; }
  async recordAccepted({ id, requestId, status }) { const row = this.byId(id); row.status = 'REQUEST_ACCEPTED';
    row.renderer_task_id = requestId; row.renderer_status = status; return row; }
  async recordStatus({ id, requestId, status }) { const row = this.byId(id); row.status = 'PROCESSING';
    row.renderer_task_id = requestId; row.renderer_status = status; return row; }
  async adopt({ id, requestId, rendererStatus, artifact, contentType, probe, provenance, cost }) {
    const row = this.byId(id); Object.assign(row, { status: 'SUCCEEDED', worker_id: null,
      renderer_task_id: requestId || row.renderer_task_id, renderer_status: rendererStatus,
      artifact_id: artifact.artifactId, artifact_version: artifact.version, artifact_storage_key: artifact.storageKey,
      artifact_content_hash: artifact.contentHash, content_type: contentType, media_probe: probe, provenance, cost }); return row;
  }
  async markFailure({ id, boundaryCrossed, validationFailed, terminal }) { const row = this.byId(id);
    row.status = validationFailed ? 'VALIDATION_FAILED' : terminal ? 'FAILED' : boundaryCrossed ? 'NEEDS_RECONCILIATION' : 'RETRYABLE'; }
  byId(id) { return [...this.rows.values()].find((row) => row.id === id); }
}

function input(productionKey, targetDurationSeconds = 2) {
  return { schemaVersion: 3, workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionKey,
    renderMode: 'FAST', renderer: 'moneyprinterturbo', fingerprint: `fingerprint-${productionKey}`,
    title: 'FAST test', objective: 'ENGAGEMENT', targetDurationSeconds, aspectRatio: '9:16',
    fastRender: { renderer: 'moneyprinterturbo', mediaSource: 'pexels', music: false, providerOptions: {} },
    voiceover: { enabled: true, text: 'Notice first.', voice: 'en-US-AvaNeural-Female', language: 'en' },
    captions: { enabled: true }, script: { brand_id: BRAND_ID, title: 'FAST test', hook: 'Notice', cta: 'Tune in',
      scenes: [{ scene_number: 1, dialogue_or_voiceover: 'Notice first.' }] } };
}

async function fixture(directory, name, args) {
  const target = path.join(directory, name);
  await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-y', ...args, target]);
  return fs.readFile(target);
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-v26-fast-'));
  try {
    const valid = await fixture(directory, 'valid.mp4', ['-f','lavfi','-i','color=c=#28323c:s=1080x1920:r=5:d=2',
      '-f','lavfi','-i','sine=frequency=330:duration=2','-shortest','-c:v','libx264','-preset','ultrafast','-crf','40',
      '-pix_fmt','yuv420p','-c:a','aac']);
    const audioOnly = await fixture(directory, 'audio.m4a', ['-f','lavfi','-i','sine=frequency=220:duration=2','-c:a','aac']);
    const repository = new MemoryRepository();
    let renders = 0; let recoveries = 0; const reviews = [];
    const adapter = { config: { enabled: true, version: 'v1.3.3', autoPublishDisabled: true }, async health() {
      return { configured: true, availability: 'AVAILABLE' };
    }, async render(_request, hooks) {
      renders += 1; await hooks.onAccepted({ requestId: `task-${renders}`, status: 'accepted' });
      await hooks.onStatus({ requestId: `task-${renders}`, status: 'processing' });
      return { renderer: 'moneyprinterturbo', requestId: `task-${renders}`, status: 'completed', output: valid,
        contentType: 'video/mp4', provenance: { renderer: 'moneyprinterturbo', version: 'v1.3.3',
          taskId: `task-${renders}`, cost: { status: 'unknown' } } };
    }, async recover({ requestId }) { recoveries += 1; return { renderer: 'moneyprinterturbo', requestId,
      status: 'completed', output: valid, contentType: 'video/mp4', provenance: { renderer: 'moneyprinterturbo',
        version: 'v1.3.3', taskId: requestId, recovery: true, cost: { status: 'unknown' } } }; } };
    const renderer = new DurableFastRenderer({ repository, adapter,
      artifactService: new ArtifactService({ storage: new FilesystemStorageAdapter({ root: directory }) }),
      mediaInspector: new FfprobeMediaInspector(), reviewService: { async registerMasterForReview(args) { reviews.push(args); } } });

    const firstInput = input('idempotent');
    const first = await renderer.render({ productionId: '33333333-3333-4333-8333-333333333331', workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID, workerId: 'worker-1', input: firstInput });
    assert.equal(first.quality.status, 'PASS'); assert.equal(first.nextAction, 'HUMAN_REVIEW');
    assert.equal(reviews[0].renderContext.renderMode, 'FAST'); assert.equal(reviews[0].quality.publicationAllowed, false);
    const second = await renderer.render({ productionId: '33333333-3333-4333-8333-333333333331', workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID, workerId: 'worker-2', input: firstInput });
    assert.equal(second.master.artifact.idempotent, true); assert.equal(renders, 1, 'persisted valid master must be reused');

    const ambiguousInput = input('ambiguous'); const ambiguousProduction = '33333333-3333-4333-8333-333333333332';
    const ambiguousIds = renderer.identities({ input: ambiguousInput, productionId: ambiguousProduction });
    const ambiguous = await repository.ensure({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: ambiguousProduction,
      renderer: 'moneyprinterturbo', rendererVersion: 'v1.3.3', inputFingerprint: ambiguousIds.inputFingerprint,
      idempotencyKey: ambiguousIds.idempotencyKey });
    ambiguous.status = 'NEEDS_RECONCILIATION';
    await assert.rejects(() => renderer.render({ productionId: ambiguousProduction, workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID, workerId: 'worker-3', input: ambiguousInput }), (error) => error.code === 'FAST_RENDER_STATE_UNRESOLVED');
    assert.equal(renders, 1, 'ambiguous execution without task ID must never submit again');

    const recoverInput = input('recover'); const recoverProduction = '33333333-3333-4333-8333-333333333333';
    const recoverIds = renderer.identities({ input: recoverInput, productionId: recoverProduction });
    const recoverRow = await repository.ensure({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID, productionId: recoverProduction,
      renderer: 'moneyprinterturbo', rendererVersion: 'v1.3.3', inputFingerprint: recoverIds.inputFingerprint,
      idempotencyKey: recoverIds.idempotencyKey });
    recoverRow.status = 'NEEDS_RECONCILIATION'; recoverRow.renderer_task_id = 'task-existing';
    await renderer.render({ productionId: recoverProduction, workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      workerId: 'worker-4', input: recoverInput });
    assert.equal(recoveries, 1); assert.equal(renders, 1, 'durable task recovery must not submit another FAST job');

    await assert.rejects(() => renderer.render({ productionId: '33333333-3333-4333-8333-333333333334',
      workspaceId: '99999999-9999-4999-8999-999999999999', brandId: BRAND_ID, workerId: 'worker-5',
      input: input('wrong-workspace') }), (error) => error.code === 'FAST_RENDER_SCOPE_MISMATCH');
    await assert.rejects(() => renderer.render({ productionId: '33333333-3333-4333-8333-333333333335',
      workspaceId: WORKSPACE_ID, brandId: '99999999-9999-4999-8999-999999999999', workerId: 'worker-5',
      input: input('wrong-brand') }), (error) => error.code === 'FAST_RENDER_SCOPE_MISMATCH');

    const validationRenderer = (bytes) => new DurableFastRenderer({ repository: new MemoryRepository(),
      adapter: { config: { enabled: true, version: 'v1.3.3', autoPublishDisabled: true }, async render(_request, hooks) {
        await hooks.onAccepted({ requestId: 'bad-task', status: 'accepted' });
        return { renderer: 'moneyprinterturbo', requestId: 'bad-task', status: 'completed', output: bytes,
          contentType: 'video/mp4', provenance: { version: 'v1.3.3', cost: { status: 'unknown' } } };
      } }, artifactService: new ArtifactService({ storage: new FilesystemStorageAdapter({ root: directory }) }),
      mediaInspector: new FfprobeMediaInspector(), reviewService: { async registerMasterForReview() { throw new Error('failed media must not enter review'); } } });
    await assert.rejects(() => validationRenderer(Buffer.from('corrupt')).render({
      productionId: '33333333-3333-4333-8333-333333333336', workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      workerId: 'worker-6', input: input('corrupt') }), (error) => error.code === 'MEDIA_UNREADABLE');
    await assert.rejects(() => validationRenderer(audioOnly).render({
      productionId: '33333333-3333-4333-8333-333333333337', workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      workerId: 'worker-7', input: input('audio-only') }), (error) => error.code === 'MEDIA_VIDEO_STREAM_MISSING');
    await assert.rejects(() => validationRenderer(valid).render({
      productionId: '33333333-3333-4333-8333-333333333338', workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      workerId: 'worker-8', input: input('duration-mismatch', 10) }),
    (error) => ['MEDIA_DURATION_TOO_SHORT','MASTER_MEDIA_VALIDATION_FAILED'].includes(error.code));
    console.log('V2.6 FAST durability, ownership, artifact validation, review, and no-publication contract passed (mock renderer only).');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
