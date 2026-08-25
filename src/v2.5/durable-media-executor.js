'use strict';

const crypto = require('node:crypto');
const { generateMediaAsset, capabilityForAssetKind, normalizeMediaResult } = require('../../worker/v2.1-media-generation');
const { canonicalFingerprint, contentTypeForKind } = require('../../worker/v2.1-master-production');
const { fromAsset } = require('../v2.8/canonical-media-request');

class DurableMediaError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DurableMediaError';
    this.code = code;
    this.details = details;
  }
}

class PostgresMediaExecutionRepository {
  constructor({ db } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    this.db = db;
  }

  async inspectSchema() {
    const result = await this.db.query(`/* v2.5:inspect-schema */
      SELECT to_regclass('v2_5.media_executions') IS NOT NULL AS ready`);
    if (!result.rows[0]?.ready) throw new DurableMediaError('V25_SCHEMA_MISSING', 'V2.5 media execution migration is required');
    return { ready: true };
  }

  async list(productionId) {
    const result = await this.db.query(`/* v2.5:list-media-executions */
      SELECT * FROM v2_5.media_executions WHERE production_id=$1 ORDER BY created_at,asset_id`, [productionId]);
    return result.rows;
  }

  async verifyTransactionalPlan({ workspaceId, brandId, objective, inputFingerprint, assets }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    const probe = `v2.5-preflight:${crypto.randomUUID()}`;
    try {
      await client.query('BEGIN');
      const production = await client.query(`/* v2.5:probe-production */
        INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,objective,metadata)
        VALUES($1,$2,$3,'DRAFT',$4,$5::jsonb) RETURNING id`,
      [workspaceId, brandId, probe, objective, JSON.stringify({ source: 'v2.5-prepaid-probe', inputFingerprint })]);
      const productionId = production.rows[0].id;
      const job = await client.query(`/* v2.5:probe-job */
        INSERT INTO v2_1.jobs(production_id,stage,status,idempotency_key,payload)
        VALUES($1,'EDIT','QUEUED',$2,$3::jsonb) RETURNING id`,
      [productionId, probe, JSON.stringify({ source: 'v2.5-prepaid-probe', providerRequestState: 'NOT_STARTED' })]);
      const claimedJob = await client.query(`/* v2.5:probe-claim-job */
        UPDATE v2_1.jobs SET status='RUNNING',worker_id='v2.5-prepaid-probe',started_at=now(),updated_at=now()
        WHERE id=$1 AND status='QUEUED' RETURNING id`, [job.rows[0].id]);
      if (!claimedJob.rows[0]) throw new DurableMediaError('V25_PREFLIGHT_FAILED', 'Pre-paid job claim failed');
      await client.query(`/* v2.5:probe-start-production */ UPDATE v2_1.productions SET status='RUNNING',started_at=now() WHERE id=$1`, [productionId]);
      for (const asset of assets) {
        const requirements = asset.generation_requirements || {};
        const capability = capabilityForAssetKind(asset.kind);
        const execution = await client.query(`/* v2.5:probe-media-execution */
          INSERT INTO v2_5.media_executions
            (workspace_id,brand_id,production_id,asset_id,kind,input_fingerprint,idempotency_key,provider,model)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [workspaceId, brandId, productionId, asset.asset_id, asset.kind,
          canonicalFingerprint({ brandId, productionId, asset }), `${probe}:${asset.asset_id}`,
          requirements.provider || (capability === 'video-generation' ? 'replicate' : 'openai-media'), requirements.model || null]);
        const claimed = await client.query(`/* v2.5:probe-claim-media */
          UPDATE v2_5.media_executions SET status='RUNNING',worker_id='v2.5-prepaid-probe',started_at=now(),updated_at=now()
          WHERE id=$1 AND status='NOT_STARTED' RETURNING id`, [execution.rows[0].id]);
        if (!claimed.rows[0]) throw new DurableMediaError('V25_PREFLIGHT_FAILED', `Pre-paid media claim failed for ${asset.asset_id}`);
      }
      await client.query('ROLLBACK');
      return { passed: true, persisted: false, mediaClaims: assets.length, providerCalls: 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (client !== this.db) client.release();
    }
  }

  async ensure({ workspaceId, brandId, productionId, asset, fingerprint, idempotencyKey, provider, model }) {
    await this.db.query(`/* v2.5:ensure-media-execution */
      INSERT INTO v2_5.media_executions
        (workspace_id,brand_id,production_id,asset_id,kind,input_fingerprint,idempotency_key,provider,model)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(production_id,asset_id) DO NOTHING`,
    [workspaceId, brandId, productionId, asset.asset_id, asset.kind, fingerprint, idempotencyKey, provider, model]);
    const result = await this.db.query(`/* v2.5:get-media-execution */
      SELECT * FROM v2_5.media_executions WHERE production_id=$1 AND asset_id=$2`, [productionId, asset.asset_id]);
    const row = result.rows[0];
    if (!row || row.brand_id !== brandId || row.workspace_id !== workspaceId || row.input_fingerprint !== fingerprint
      || row.idempotency_key !== idempotencyKey || row.provider !== provider || row.model !== model) {
      throw new DurableMediaError('MEDIA_EXECUTION_CONFLICT', `Asset ${asset.asset_id} already has different durable execution identity`);
    }
    return row;
  }

  async claim({ id, workerId }) {
    const result = await this.db.query(`/* v2.5:claim-media-execution */
      UPDATE v2_5.media_executions SET status='RUNNING',worker_id=$2,started_at=coalesce(started_at,now()),
        error='{}'::jsonb,updated_at=now()
      WHERE id=$1 AND status IN ('NOT_STARTED','RETRYABLE') RETURNING *`, [id, workerId]);
    return result.rows[0] || null;
  }

  async markBoundary({ id, workerId }) {
    const result = await this.db.query(`/* v2.5:mark-media-provider-boundary */
      UPDATE v2_5.media_executions SET status='MAY_HAVE_STARTED',provider_boundary_at=now(),updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status='RUNNING' RETURNING *`, [id, workerId]);
    if (!result.rows[0]) throw new DurableMediaError('MEDIA_EXECUTION_FENCED', 'Media execution ownership was lost before provider boundary');
    return result.rows[0];
  }

  async recordProviderRequest({ id, workerId, requestId, providerStatus = null }) {
    const result = await this.db.query(`/* v2.5:record-provider-request */
      UPDATE v2_5.media_executions SET provider_request_id=$3,provider_status=$4,updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status IN ('MAY_HAVE_STARTED','NEEDS_RECONCILIATION') RETURNING *`,
    [id, workerId, requestId, providerStatus]);
    if (!result.rows[0]) throw new DurableMediaError('MEDIA_EXECUTION_FENCED', 'Media execution ownership was lost while recording provider request');
    return result.rows[0];
  }

  async adopt({ id, artifact, media, probe, workerId }) {
    const result = await this.db.query(`/* v2.5:complete-media-execution */
      UPDATE v2_5.media_executions SET status='SUCCEEDED',worker_id=NULL,
        provider_request_id=coalesce($3,provider_request_id),provider_status='succeeded',
        artifact_id=$4,artifact_version=$5,artifact_storage_key=$6,artifact_content_hash=$7,
        content_type=$8,duration_ms=$9,media_probe=$10::jsonb,provenance=$11::jsonb,error='{}'::jsonb,
        completed_at=now(),updated_at=now()
      WHERE id=$1 AND ($2::text IS NULL OR worker_id=$2 OR worker_id IS NULL) RETURNING *`,
    [id, workerId || null, media.requestId || media.provenance?.predictionId || null,
      artifact.artifactId, artifact.version, artifact.storageKey, artifact.contentHash, media.contentType,
      probe?.durationMs || null, JSON.stringify(probe || {}), JSON.stringify(media.provenance || {})]);
    if (!result.rows[0]) throw new DurableMediaError('MEDIA_EXECUTION_FENCED', 'Media execution ownership was lost before artifact adoption');
    return result.rows[0];
  }

  async markFailure({ id, workerId, error, boundaryCrossed, terminal = false }) {
    const status = terminal ? 'FAILED' : boundaryCrossed ? 'NEEDS_RECONCILIATION' : 'RETRYABLE';
    await this.db.query(`/* v2.5:fail-media-execution */
      UPDATE v2_5.media_executions SET status=$3,worker_id=NULL,error=$4::jsonb,updated_at=now()
      WHERE id=$1 AND ($2::text IS NULL OR worker_id=$2 OR worker_id IS NULL)`,
    [id, workerId || null, status, JSON.stringify({ code: error.code || 'MEDIA_EXECUTION_FAILED', message: error.message })]);
  }
}

function parseProvenanceArtifact(artifact) {
  if (!artifact?.content) return {};
  try { return JSON.parse(artifact.content.toString('utf8')); } catch { return {}; }
}

class DurableMediaExecutor {
  constructor({ repository, providerGateway, artifactService, mediaInspector, assetRepository = null } = {}) {
    if (!repository) throw new Error('repository is required');
    if (!providerGateway) throw new Error('providerGateway is required');
    if (!artifactService) throw new Error('artifactService is required');
    if (!mediaInspector) throw new Error('mediaInspector is required');
    this.repository = repository;
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.mediaInspector = mediaInspector;
    this.assetRepository = assetRepository;
  }

  selection(asset) {
    const capability = capabilityForAssetKind(asset.kind);
    const requirements = asset.generation_requirements || {};
    return this.providerGateway.select({
      capability, routeKey: `media:${asset.kind}`, provider: requirements.provider, model: requirements.model,
    });
  }

  identities({ brandId, productionId, asset }) {
    const fingerprint = canonicalFingerprint({ brandId, productionId, asset });
    const artifactId = `brand:${brandId}:asset:${asset.asset_id}`;
    const idempotencyKey = `${brandId}:${productionId}:media:${asset.asset_id}:${fingerprint}`;
    return { fingerprint, artifactId, idempotencyKey, provenanceArtifactId: `${artifactId}:provenance`, provenanceIdempotencyKey: `${idempotencyKey}:provenance` };
  }

  async cached({ identities, asset, row }) {
    const artifact = await this.artifactService.getVersionByIdempotency({
      artifactId: identities.artifactId, type: 'binary', idempotencyKey: identities.idempotencyKey,
      provider: row.provider, model: row.model, validationStatus: 'validated_media',
    });
    if (!artifact) return null;
    const provenanceArtifact = await this.artifactService.getVersionByIdempotency({
      artifactId: identities.provenanceArtifactId, type: 'text', idempotencyKey: identities.provenanceIdempotencyKey,
      provider: row.provider, model: row.model, validationStatus: 'recorded',
    });
    const recorded = parseProvenanceArtifact(provenanceArtifact);
    return {
      assetId: asset.asset_id, kind: asset.kind, contentType: recorded.contentType || row.content_type || contentTypeForKind(asset.kind),
      bytes: artifact.content, mediaUrl: null,
      temporal: asset.temporal || asset.generation_requirements?.temporal || null,
      provider: recorded.provider || row.provider, model: recorded.model || row.model,
      requestId: recorded.requestId || row.provider_request_id || null, usage: recorded.usage || null,
      provenance: Object.freeze({ ...(recorded.provenance || row.provenance || {}), source: 'immutable-artifact-cache' }),
      artifact, provenanceArtifact,
    };
  }

  async execute({ workspaceId, productionId, brandId, workerId, asset }) {
    const selection = this.selection(asset);
    const identities = this.identities({ brandId, productionId, asset });
    let row = await this.repository.ensure({ workspaceId, brandId, productionId, asset,
      fingerprint: identities.fingerprint, idempotencyKey: identities.idempotencyKey,
      provider: selection.provider, model: selection.model });

    const cached = await this.cached({ identities, asset, row });
    if (cached) {
      const probe = row.media_probe && Object.keys(row.media_probe).length ? row.media_probe
        : await this.mediaInspector.inspect({ bytes: cached.bytes, contentType: cached.contentType, kind: asset.kind,
          expectedDurationMs: asset.generation_requirements?.target_clip_duration_ms || null });
      row = await this.repository.adopt({ id: row.id, artifact: cached.artifact, media: cached, probe, workerId: null });
      await this.registerAsset({ productionId, asset, media: cached, workerId, identities, probe });
      return Object.freeze({ ...cached, brandId, durableExecutionId: row.id, mediaProbe: probe });
    }

    if (row.status === 'SUCCEEDED') {
      throw new DurableMediaError('MEDIA_ARTIFACT_MISSING', `Succeeded asset ${asset.asset_id} has no immutable artifact`);
    }

    let media;
    let boundaryCrossed = false;
    try {
      if (['MAY_HAVE_STARTED','NEEDS_RECONCILIATION'].includes(row.status)) {
        if (!row.provider_request_id || typeof this.providerGateway.recover !== 'function') {
          throw new DurableMediaError('MEDIA_PROVIDER_STATE_UNRESOLVED',
            `Asset ${asset.asset_id} may have crossed a paid provider boundary; refusing a duplicate generation`, {
              executionId: row.id, provider: row.provider, requestId: row.provider_request_id || null,
            });
        }
        boundaryCrossed = true;
        const recovered = await this.providerGateway.recover({
          capability: capabilityForAssetKind(asset.kind), provider: row.provider, model: row.model,
          requestId: row.provider_request_id, canonicalRequest: fromAsset({ ...asset,
            generation_requirements: { ...(asset.generation_requirements || {}), provider: row.provider, model: row.model } }),
        });
        media = normalizeMediaResult({ asset, response: recovered });
      } else {
        row = await this.repository.claim({ id: row.id, workerId });
        if (!row) throw new DurableMediaError('MEDIA_EXECUTION_NOT_CLAIMED', `Asset ${asset.asset_id} is already claimed or terminal`);
        row = await this.repository.markBoundary({ id: row.id, workerId });
        boundaryCrossed = true;
        media = await generateMediaAsset({
          providerGateway: this.providerGateway, asset, productionId, brandId, workerId,
          onProviderRequest: async ({ requestId, status }) => {
            row = await this.repository.recordProviderRequest({ id: row.id, workerId, requestId, providerStatus: status });
          },
        });
        if (media.requestId && !row.provider_request_id) {
          row = await this.repository.recordProviderRequest({ id: row.id, workerId, requestId: media.requestId, providerStatus: 'succeeded' });
        }
      }

      if (!Buffer.isBuffer(media.bytes) || media.bytes.length === 0) {
        throw new DurableMediaError('MASTER_MEDIA_MUST_BE_DURABLE', `Generated media ${asset.asset_id} must contain durable bytes`);
      }
      const probe = await this.mediaInspector.inspect({ bytes: media.bytes, contentType: media.contentType, kind: asset.kind,
        expectedDurationMs: asset.generation_requirements?.target_clip_duration_ms || null });
      const artifact = await this.artifactService.createVersion({
        artifactId: identities.artifactId, type: 'binary', content: media.bytes, idempotencyKey: identities.idempotencyKey,
        provider: media.provider, model: media.model, validationStatus: 'validated_media',
      });
      const provenanceArtifact = await this.artifactService.createVersion({
        artifactId: identities.provenanceArtifactId, type: 'text',
        content: JSON.stringify({ schemaVersion: 2, brandId, productionId, assetId: asset.asset_id,
          contentType: media.contentType, provider: media.provider, model: media.model, requestId: media.requestId,
          usage: media.usage, provenance: media.provenance, mediaProbe: probe,
          sourceMediaUrl: media.mediaUrl, mediaArtifactStorageKey: artifact.storageKey }),
        idempotencyKey: identities.provenanceIdempotencyKey, provider: media.provider, model: media.model, validationStatus: 'recorded',
      });
      const resolved = Object.freeze({ ...media, brandId, artifact, provenanceArtifact, mediaProbe: probe });
      row = await this.repository.adopt({ id: row.id, artifact, media: resolved, probe, workerId });
      await this.registerAsset({ productionId, asset, media: resolved, workerId, identities, probe });
      return Object.freeze({ ...resolved, durableExecutionId: row.id });
    } catch (error) {
      const terminal = /PREDICTION_(FAILED|CANCELED)/.test(error.code || '');
      await this.repository.markFailure({ id: row.id, workerId, error, boundaryCrossed, terminal }).catch(() => {});
      throw error;
    }
  }

  async registerAsset({ productionId, asset, media, workerId, identities, probe }) {
    if (!this.assetRepository) return;
    await this.assetRepository.registerResolved({ client: this.repository.db, productionId, asset,
      artifact: media.artifact, workerId, key: identities.fingerprint,
      metadata: { provider: media.provider, model: media.model, requestId: media.requestId || null,
        contentType: media.contentType, durationMs: probe?.durationMs || null, provenance: media.provenance || {} } });
  }
}

module.exports = {
  DurableMediaError,
  DurableMediaExecutor,
  PostgresMediaExecutionRepository,
};
