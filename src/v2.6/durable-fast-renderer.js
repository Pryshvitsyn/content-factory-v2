'use strict';

const crypto = require('node:crypto');
const { validateMasterProbe } = require('../v2.5/media-validator');

const AMBIGUOUS = new Set(['MAY_HAVE_STARTED', 'REQUEST_ACCEPTED', 'PROCESSING', 'NEEDS_RECONCILIATION']);

class FastRenderError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'FastRenderError';
    this.code = code;
    this.details = details;
  }
}

function fingerprint(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    return input;
  };
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

class PostgresFastRenderRepository {
  constructor({ db } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    this.db = db;
  }

  async inspectSchema() {
    const result = await this.db.query("/* v2.6:inspect-schema */ SELECT to_regclass('v2_6.fast_render_executions') AS table_name");
    if (!result.rows[0]?.table_name) throw new FastRenderError('V26_SCHEMA_MISSING', 'V2.6 FAST render execution migration is required');
    return { ready: true };
  }

  async list(productionId) {
    const result = await this.db.query('/* v2.6:list-fast-renders */ SELECT * FROM v2_6.fast_render_executions WHERE production_id=$1 ORDER BY created_at', [productionId]);
    return result.rows;
  }

  async verifyTransactionalPlan({ workspaceId, brandId, objective, inputFingerprint, renderer, rendererVersion }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    const probe = `v2.6-fast-preflight:${crypto.randomUUID()}`;
    try {
      await client.query('BEGIN');
      const production = await client.query(`/* v2.6:probe-production */
        INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,objective,metadata)
        VALUES($1,$2,$3,'DRAFT',$4,$5::jsonb) RETURNING id`,
      [workspaceId, brandId, probe, objective, JSON.stringify({ source: 'v2.6-fast-preflight', inputFingerprint })]);
      const execution = await client.query(`/* v2.6:probe-fast-render */
        INSERT INTO v2_6.fast_render_executions
          (workspace_id,brand_id,production_id,renderer,renderer_version,input_fingerprint,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [workspaceId, brandId, production.rows[0].id, renderer, rendererVersion, inputFingerprint, probe]);
      const claimed = await client.query(`/* v2.6:probe-fast-claim */
        UPDATE v2_6.fast_render_executions SET status='RUNNING',worker_id='v2.6-fast-preflight',started_at=now(),updated_at=now()
        WHERE id=$1 AND status='NOT_STARTED' RETURNING id`, [execution.rows[0].id]);
      if (!claimed.rows[0]) throw new FastRenderError('V26_PREFLIGHT_FAILED', 'FAST render transactional claim failed');
      await client.query('ROLLBACK');
      return { passed: true, persisted: false, rendererClaims: 1, rendererJobs: 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (client !== this.db) client.release();
    }
  }

  async ensure({ workspaceId, brandId, productionId, renderer, rendererVersion, inputFingerprint, idempotencyKey }) {
    await this.db.query(`/* v2.6:ensure-fast-render */
      INSERT INTO v2_6.fast_render_executions
        (workspace_id,brand_id,production_id,renderer,renderer_version,input_fingerprint,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(production_id,render_mode,renderer) DO NOTHING`,
    [workspaceId, brandId, productionId, renderer, rendererVersion, inputFingerprint, idempotencyKey]);
    const result = await this.db.query(`/* v2.6:get-fast-render */
      SELECT * FROM v2_6.fast_render_executions WHERE production_id=$1 AND render_mode='FAST' AND renderer=$2`,
    [productionId, renderer]);
    const row = result.rows[0];
    if (!row || row.workspace_id !== workspaceId || row.brand_id !== brandId || row.input_fingerprint !== inputFingerprint
      || row.idempotency_key !== idempotencyKey || row.renderer_version !== rendererVersion) {
      throw new FastRenderError('FAST_RENDER_IDENTITY_CONFLICT', 'Existing FAST execution has a different canonical identity');
    }
    return row;
  }

  async claim({ id, workerId }) {
    const result = await this.db.query(`/* v2.6:claim-fast-render */
      UPDATE v2_6.fast_render_executions SET status='RUNNING',worker_id=$2,started_at=coalesce(started_at,now()),
        error='{}'::jsonb,updated_at=now()
      WHERE id=$1 AND status IN ('NOT_STARTED','RETRYABLE') RETURNING *`, [id, workerId]);
    return result.rows[0] || null;
  }

  async markBoundary({ id, workerId }) {
    const result = await this.db.query(`/* v2.6:mark-fast-boundary */
      UPDATE v2_6.fast_render_executions SET status='MAY_HAVE_STARTED',renderer_boundary_at=now(),updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status='RUNNING' RETURNING *`, [id, workerId]);
    if (!result.rows[0]) throw new FastRenderError('FAST_RENDER_FENCED', 'FAST execution ownership was lost before renderer boundary');
    return result.rows[0];
  }

  async recordAccepted({ id, workerId, requestId, status = 'accepted' }) {
    const result = await this.db.query(`/* v2.6:record-fast-task */
      UPDATE v2_6.fast_render_executions SET status='REQUEST_ACCEPTED',renderer_task_id=$3,renderer_status=$4,
        accepted_at=coalesce(accepted_at,now()),updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status IN ('MAY_HAVE_STARTED','REQUEST_ACCEPTED','PROCESSING')
        AND (renderer_task_id IS NULL OR renderer_task_id=$3) RETURNING *`, [id, workerId, requestId, status]);
    if (!result.rows[0]) throw new FastRenderError('FAST_RENDER_FENCED', 'FAST execution ownership was lost while recording renderer task');
    return result.rows[0];
  }

  async recordStatus({ id, workerId, requestId, status }) {
    const result = await this.db.query(`/* v2.6:record-fast-status */
      UPDATE v2_6.fast_render_executions SET status='PROCESSING',renderer_status=$4,updated_at=now()
      WHERE id=$1 AND ($2::text IS NULL OR worker_id=$2 OR worker_id IS NULL) AND renderer_task_id=$3
        AND status IN ('REQUEST_ACCEPTED','PROCESSING','NEEDS_RECONCILIATION') RETURNING *`,
    [id, workerId || null, requestId, status]);
    return result.rows[0] || null;
  }

  async adopt({ id, workerId, requestId, rendererStatus, artifact, contentType, probe, provenance, cost }) {
    const result = await this.db.query(`/* v2.6:complete-fast-render */
      UPDATE v2_6.fast_render_executions SET status='SUCCEEDED',worker_id=NULL,
        renderer_task_id=coalesce($3,renderer_task_id),renderer_status=$4,
        artifact_id=$5,artifact_version=$6,artifact_storage_key=$7,artifact_content_hash=$8,
        content_type=$9,duration_ms=$10,media_probe=$11::jsonb,provenance=$12::jsonb,cost=$13::jsonb,
        error='{}'::jsonb,completed_at=now(),updated_at=now()
      WHERE id=$1 AND ($2::text IS NULL OR worker_id=$2 OR worker_id IS NULL) RETURNING *`,
    [id, workerId || null, requestId || null, rendererStatus || 'completed', artifact.artifactId, artifact.version,
      artifact.storageKey, artifact.contentHash, contentType, probe.durationMs, JSON.stringify(probe),
      JSON.stringify(provenance || {}), JSON.stringify(cost || { status: 'unknown' })]);
    if (!result.rows[0]) throw new FastRenderError('FAST_RENDER_FENCED', 'FAST execution ownership was lost before artifact adoption');
    return result.rows[0];
  }

  async markFailure({ id, workerId, error, boundaryCrossed, hasTaskId, validationFailed = false, terminal = false }) {
    const status = validationFailed ? 'VALIDATION_FAILED' : terminal ? 'FAILED'
      : boundaryCrossed ? 'NEEDS_RECONCILIATION' : 'RETRYABLE';
    await this.db.query(`/* v2.6:fail-fast-render */
      UPDATE v2_6.fast_render_executions SET status=$3,worker_id=NULL,error=$4::jsonb,updated_at=now()
      WHERE id=$1 AND ($2::text IS NULL OR worker_id=$2 OR worker_id IS NULL)`,
    [id, workerId || null, status, JSON.stringify({ code: error.code || 'FAST_RENDER_FAILED', message: error.message,
      rendererTaskKnown: hasTaskId === true })]);
  }
}

class DurableFastRenderer {
  constructor({ repository, adapter, artifactService, mediaInspector, reviewService } = {}) {
    if (!repository || !adapter || !artifactService || !mediaInspector || !reviewService) throw new Error('FAST renderer dependencies are required');
    this.repository = repository;
    this.adapter = adapter;
    this.artifactService = artifactService;
    this.mediaInspector = mediaInspector;
    this.reviewService = reviewService;
  }

  identities({ input, productionId }) {
    const inputFingerprint = fingerprint({ workspaceId: input.workspaceId, brandId: input.brandId, productionId,
      renderMode: 'FAST', renderer: input.fastRender.renderer, inputFingerprint: input.fingerprint });
    const idempotencyKey = `${input.workspaceId}:${input.brandId}:${productionId}:FAST:${input.fastRender.renderer}:${inputFingerprint}`;
    return { inputFingerprint, idempotencyKey, artifactId: `production:${productionId}:master`,
      artifactKey: `${idempotencyKey}:master`, provenanceId: `production:${productionId}:fast-render-provenance`,
      provenanceKey: `${idempotencyKey}:provenance` };
  }

  async preflight({ input, brand, existing, config }) {
    const normalizedPlan = this.adapter.validate(this.request(input));
    await this.repository.inspectSchema();
    const probe = await this.repository.verifyTransactionalPlan({ workspaceId: brand.workspaceId, brandId: brand.id,
      objective: input.objective, inputFingerprint: input.fingerprint, renderer: input.fastRender.renderer,
      rendererVersion: config.fastRenderer.version });
    const executions = existing?.productionId ? await this.repository.list(existing.productionId) : [];
    const availability = await this.adapter.health();
    return { probe, executions, availability, normalizedPlan };
  }

  plan({ input, config, existing, laneState }) {
    const execution = laneState.executions.find((item) => item.renderer === input.fastRender.renderer) || null;
    const completed = existing?.jobStatus === 'COMPLETED' || execution?.status === 'SUCCEEDED';
    const ambiguous = execution && AMBIGUOUS.has(execution.status);
    return {
      renderMode: 'FAST', renderer: input.fastRender.renderer, rendererVersion: config.fastRenderer.version,
      provider: null, model: null, resolution: '1080x1920', aspectRatio: input.aspectRatio,
      expectedVideoGenerations: 0, expectedAudioGenerations: 0, expectedPaidProviderCalls: 0,
      expectedRendererJobs: completed || ambiguous ? 0 : 1,
      expectedExternalServiceCalls: completed || ambiguous ? 0 : 1,
      providerExecutions: 0,
      ambiguousRendererExecutions: ambiguous ? 1 : 0,
      existingRendererState: execution?.status || null,
      masterAssemblyMode: 'external-fast-renderer',
      rendererAvailability: laneState.availability,
      normalizedFastPlan: laneState.normalizedPlan,
      estimatedCost: null,
      costStatus: 'unknown',
      costNote: 'Renderer and any stock, voice, or music dependencies may incur external cost; no zero-cost claim is made.',
      dryRunRendererExecutions: 0,
    };
  }

  request(input) {
    return {
      production: input,
      script: input.script,
      scenes: input.script.scenes,
      voiceover: input.voiceover,
      captions: input.captions,
      mediaPreferences: { mediaSource: input.fastRender.mediaSource, music: input.fastRender.music,
        providerOptions: input.fastRender.providerOptions },
      outputProfile: { aspectRatio: input.aspectRatio, width: 1080, height: 1920,
        durationSeconds: input.targetDurationSeconds },
    };
  }

  async cached({ identities, row }) {
    return this.artifactService.getVersionByIdempotency({ artifactId: identities.artifactId, type: 'binary',
      idempotencyKey: identities.artifactKey, provider: row.renderer, model: row.renderer_version,
      validationStatus: 'awaiting_human_approval' });
  }

  async validate({ input, bytes, contentType }) {
    const probe = await this.mediaInspector.inspect({ bytes, contentType, kind: 'video',
      expectedDurationMs: Math.round(input.targetDurationSeconds * 1000) });
    const mediaValidation = validateMasterProbe({ probe, width: 1080, height: 1920,
      durationMs: Math.round(input.targetDurationSeconds * 1000), durationToleranceMs: 1500,
      requireAudio: input.voiceover.enabled === true || input.fastRender.music === true });
    const checks = Object.entries(mediaValidation.checks).map(([code, ok]) => ({
      code, status: ok ? 'PASS' : 'FAIL', message: `FAST master ${code}`,
    }));
    return { probe, mediaValidation, quality: Object.freeze({ status: 'PASS', score: 1,
      checks: Object.freeze(checks), readyForHumanReview: true, publicationAllowed: false,
      approvalStatus: 'AWAITING_HUMAN_APPROVAL' }) };
  }

  async registerReview({ input, productionId, artifact, contentType, validation, requestId, provenance }) {
    const media = Object.freeze({ assetId: 'fast-rendered-master', kind: 'video', contentType,
      provider: input.fastRender.renderer, model: provenance.version || null, requestId,
      artifact, mediaProbe: validation.probe, provenance });
    await this.reviewService.registerMasterForReview({ productionId, brandId: input.brandId,
      master: { artifact, contentType, probe: validation.probe }, script: input.script,
      quality: validation.quality, mediaResults: [media], renderContext: {
        renderMode: 'FAST', renderer: input.fastRender.renderer, rendererStatus: 'SUCCEEDED',
        cost: provenance.cost || { status: 'unknown' }, provenance,
      } });
    return media;
  }

  async render({ productionId, workspaceId, brandId, workerId, input }) {
    if (!input || input.renderMode !== 'FAST' || input.workspaceId !== workspaceId || input.brandId !== brandId) {
      throw new FastRenderError('FAST_RENDER_SCOPE_MISMATCH', 'Canonical FAST input scope is required');
    }
    if (this.adapter.config.enabled !== true) throw new FastRenderError('FAST_RENDERER_DISABLED', 'MoneyPrinterTurbo execution is disabled');
    if (this.adapter.config.autoPublishDisabled !== true) {
      throw new FastRenderError('FAST_PUBLICATION_GATE_REQUIRED', 'FAST renderer automatic publication must be explicitly disabled');
    }
    const identities = this.identities({ input, productionId });
    let row = await this.repository.ensure({ workspaceId, brandId, productionId, renderer: input.fastRender.renderer,
      rendererVersion: this.adapter.config.version, inputFingerprint: identities.inputFingerprint,
      idempotencyKey: identities.idempotencyKey });
    const cached = await this.cached({ identities, row });
    if (cached) {
      const validation = await this.validate({ input, bytes: cached.content, contentType: row.content_type || 'video/mp4' });
      const provenance = { ...(row.provenance || {}), renderer: row.renderer, version: row.renderer_version,
        source: 'immutable-artifact-cache', cost: row.cost || { status: 'unknown' } };
      row = await this.repository.adopt({ id: row.id, workerId: null, requestId: row.renderer_task_id,
        rendererStatus: row.renderer_status, artifact: cached, contentType: row.content_type || 'video/mp4',
        probe: validation.probe, provenance, cost: row.cost });
      const media = await this.registerReview({ input, productionId, artifact: cached,
        contentType: row.content_type || 'video/mp4', validation, requestId: row.renderer_task_id, provenance });
      return this.result({ input, productionId, artifact: cached, contentType: row.content_type || 'video/mp4', validation, media });
    }
    if (row.status === 'SUCCEEDED') throw new FastRenderError('FAST_RENDER_ARTIFACT_MISSING', 'Succeeded FAST render has no immutable master artifact');

    let response;
    let boundaryCrossed = false;
    try {
      if (AMBIGUOUS.has(row.status)) {
        if (!row.renderer_task_id) throw new FastRenderError('FAST_RENDER_STATE_UNRESOLVED',
          'FAST renderer may have started but no task ID is durable; refusing a duplicate job', { executionId: row.id });
        boundaryCrossed = true;
        response = await this.adapter.recover({ requestId: row.renderer_task_id, request: this.request(input),
          onStatus: async ({ requestId, status }) => this.repository.recordStatus({ id: row.id, workerId: null, requestId, status }) });
      } else {
        row = await this.repository.claim({ id: row.id, workerId });
        if (!row) throw new FastRenderError('FAST_RENDER_NOT_CLAIMED', 'FAST execution is claimed or terminal');
        row = await this.repository.markBoundary({ id: row.id, workerId });
        boundaryCrossed = true;
        response = await this.adapter.render(this.request(input), {
          onAccepted: async ({ requestId, status }) => {
            row = await this.repository.recordAccepted({ id: row.id, workerId, requestId, status });
          },
          onStatus: async ({ requestId, status }) => {
            await this.repository.recordStatus({ id: row.id, workerId, requestId, status });
          },
        });
      }
      const validation = await this.validate({ input, bytes: response.output, contentType: response.contentType });
      const artifact = await this.artifactService.createVersion({ artifactId: identities.artifactId, type: 'binary',
        content: response.output, idempotencyKey: identities.artifactKey, provider: response.renderer,
        model: response.provenance.version, validationStatus: 'awaiting_human_approval' });
      const provenance = Object.freeze({ ...response.provenance, renderMode: 'FAST', renderer: response.renderer,
        contentFactoryOwnedStorageKey: artifact.storageKey, inputFingerprint: input.fingerprint });
      await this.artifactService.createVersion({ artifactId: identities.provenanceId, type: 'text',
        content: JSON.stringify({ schemaVersion: 1, workspaceId, brandId, productionId, requestId: response.requestId,
          artifactId: artifact.artifactId, artifactVersion: artifact.version, artifactStorageKey: artifact.storageKey,
          mediaProbe: validation.probe, provenance }), idempotencyKey: identities.provenanceKey,
        provider: response.renderer, model: response.provenance.version, validationStatus: 'recorded' });
      row = await this.repository.adopt({ id: row.id, workerId, requestId: response.requestId,
        rendererStatus: response.status, artifact, contentType: response.contentType, probe: validation.probe,
        provenance, cost: response.provenance.cost });
      const media = await this.registerReview({ input, productionId, artifact, contentType: response.contentType,
        validation, requestId: response.requestId, provenance });
      return this.result({ input, productionId, artifact, contentType: response.contentType, validation, media });
    } catch (error) {
      const validationFailed = ['MASTER_MEDIA_VALIDATION_FAILED','MEDIA_EMPTY','MEDIA_UNREADABLE','MEDIA_VIDEO_STREAM_MISSING','MEDIA_DURATION_TOO_SHORT'].includes(error.code);
      const terminal = error.code === 'MPT_TASK_FAILED';
      await this.repository.markFailure({ id: row.id, workerId, error, boundaryCrossed,
        hasTaskId: Boolean(row.renderer_task_id), validationFailed, terminal }).catch(() => {});
      throw error;
    }
  }

  result({ input, productionId, artifact, contentType, validation, media }) {
    return Object.freeze({ productionId, brandId: input.brandId, fingerprint: input.fingerprint,
      timeline: { productionId, durationMs: Math.round(input.targetDurationSeconds * 1000) },
      assembly: { clips: [{ media }] },
      master: Object.freeze({ artifact, contentType, probe: validation.probe }),
      mediaValidation: validation.mediaValidation, quality: validation.quality, nextAction: 'HUMAN_REVIEW' });
  }
}

module.exports = { AMBIGUOUS, DurableFastRenderer, FastRenderError, PostgresFastRenderRepository };
