'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const { buildWanInput, DEFAULT_MODEL } = require('../../src/providers/replicate-wan-video-adapter');
const { validateStructuredConsistency } = require('../../worker/v2.1-production-orchestrator');
const { canonicalFingerprint } = require('../../worker/v2.1-master-production');
const {
  assertSchemaCompatible,
  inspectSchemaCompatibility,
  verifyArtifactStorage,
  verifyTransactionalLiveWrites,
} = require('./schema-compatibility');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const OBJECTIVES = new Set(['ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT']);

class LiveProductionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LiveProductionError';
    this.code = code;
    this.details = details;
  }
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new LiveProductionError('LIVE_INPUT_INVALID', `${name} is required`);
  return value.trim();
}

function integer(name, value) {
  if (!Number.isInteger(value)) throw new LiveProductionError('LIVE_INPUT_INVALID', `${name} must be an integer`);
  return value;
}

function resolveLiveConfiguration(env = process.env) {
  const paidFlag = env.LIVE_PAID_GENERATION;
  if (!['true', 'false'].includes(paidFlag)) {
    throw new LiveProductionError('LIVE_PAID_GATE_REQUIRED', 'LIVE_PAID_GENERATION must be explicitly true or false');
  }
  if (env.VIDEO_PROVIDER !== 'replicate') {
    throw new LiveProductionError('LIVE_PROVIDER_MISMATCH', 'VIDEO_PROVIDER must be replicate');
  }
  if (!env.REPLICATE_API_TOKEN) {
    throw new LiveProductionError('LIVE_REPLICATE_TOKEN_REQUIRED', 'REPLICATE_API_TOKEN is required');
  }
  return Object.freeze({
    live: paidFlag === 'true',
    databaseUrl: text('DATABASE_URL', env.DATABASE_URL),
    storageRoot: text('CONTENT_FACTORY_STORAGE_ROOT', env.CONTENT_FACTORY_STORAGE_ROOT),
    inputFile: text('LIVE_PRODUCTION_INPUT', env.LIVE_PRODUCTION_INPUT),
    provider: 'replicate',
    model: env.REPLICATE_VIDEO_MODEL || DEFAULT_MODEL,
    workerId: env.LIVE_PRODUCTION_WORKER_ID || `v2.4-live-cli:${process.pid}`,
  });
}

function buildStructuredLiveInput(raw = {}, overrides = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LiveProductionError('LIVE_INPUT_INVALID', 'input must be a JSON object');
  const brandId = text('brand_id', raw.brand_id);
  if (!UUID_PATTERN.test(brandId)) throw new LiveProductionError('LIVE_INPUT_INVALID', 'brand_id must be a UUID');
  const liveTestKey = text('live_test_key', raw.live_test_key);
  if (!LIVE_KEY_PATTERN.test(liveTestKey)) throw new LiveProductionError('LIVE_INPUT_INVALID', 'live_test_key has invalid characters or length');
  const title = text('title', raw.title);
  const objective = text('objective', raw.objective);
  if (!OBJECTIVES.has(objective)) throw new LiveProductionError('LIVE_INPUT_INVALID', 'objective is not canonical');
  const hook = text('hook', raw.hook);
  const cta = text('cta', raw.cta);
  const scene = raw.scene;
  const shot = raw.shot;
  const video = raw.video;
  const continuity = raw.continuity;
  if (!scene || typeof scene !== 'object') throw new LiveProductionError('LIVE_INPUT_INVALID', 'scene is required');
  if (!shot || typeof shot !== 'object') throw new LiveProductionError('LIVE_INPUT_INVALID', 'shot is required');
  if (!video || typeof video !== 'object') throw new LiveProductionError('LIVE_INPUT_INVALID', 'video is required');
  if (!continuity || typeof continuity !== 'object' || Array.isArray(continuity)) throw new LiveProductionError('LIVE_INPUT_INVALID', 'continuity is required');

  const profile = {
    prompt: text('video.prompt', video.prompt),
    resolution: overrides.resolution || video.resolution || '480p',
    aspectRatio: overrides.aspectRatio || video.aspect_ratio || '9:16',
    numFrames: integer('video.num_frames', Number(overrides.numFrames ?? video.num_frames ?? 81)),
    framesPerSecond: integer('video.frames_per_second', Number(overrides.framesPerSecond ?? video.frames_per_second ?? 16)),
    goFast: overrides.goFast ?? video.go_fast ?? true,
  };
  if (typeof profile.goFast !== 'boolean') throw new LiveProductionError('LIVE_INPUT_INVALID', 'video.go_fast must be a boolean');
  buildWanInput(profile);
  const durationSeconds = profile.numFrames / profile.framesPerSecond;
  const durationMs = Math.round(durationSeconds * 1000);
  const assetId = text('video.asset_id', video.asset_id || 'live-video-1');
  const shotId = text('shot.shot_id', shot.shot_id || 'live-shot-1');

  const script = {
    brand_id: brandId,
    title,
    hook,
    cta,
    scenes: [{
      scene_number: 1,
      visual: text('scene.visual', scene.visual),
      duration_seconds: durationSeconds,
      dialogue_or_voiceover: scene.dialogue_or_voiceover || `${hook} ${cta}`,
    }],
  };
  const shotPlan = {
    brand_id: brandId,
    shots: [{
      shot_id: shotId,
      scene_id: '1',
      duration_seconds: durationSeconds,
      framing: text('shot.framing', shot.framing),
      camera: text('shot.camera', shot.camera),
      subject: text('shot.subject', shot.subject),
      action: text('shot.action', shot.action),
      required_assets: [assetId],
    }],
    continuity: {
      characters: Array.isArray(continuity.characters) ? continuity.characters : [],
      locations: Array.isArray(continuity.locations) ? continuity.locations : [],
      products: Array.isArray(continuity.products) ? continuity.products : [],
      wardrobe: Array.isArray(continuity.wardrobe) ? continuity.wardrobe : [],
      props: Array.isArray(continuity.props) ? continuity.props : [],
      visual_style: text('continuity.visual_style', continuity.visual_style),
    },
  };
  const assetPlan = {
    brand_id: brandId,
    assets: [{
      asset_id: assetId,
      kind: 'video',
      description: profile.prompt,
      source_preference: 'generate',
      generation_requirements: {
        role: 'primary_visual',
        prompt: profile.prompt,
        resolution: profile.resolution,
        aspect_ratio: profile.aspectRatio,
        num_frames: profile.numFrames,
        frames_per_second: profile.framesPerSecond,
        go_fast: Boolean(profile.goFast),
        temporal: { startMs: 0, endMs: durationMs, durationMs },
      },
      required_for_shots: [shotId],
    }],
  };

  validateStructuredConsistency('SCRIPT', script, []);
  validateStructuredConsistency('SHOT_PLAN', shotPlan, [JSON.stringify(script)]);
  validateStructuredConsistency('ASSET_PLAN', assetPlan, [JSON.stringify(shotPlan)]);
  const normalized = { brandId, liveTestKey, title, objective, script, shotPlan, assetPlan, profile };
  return Object.freeze({ ...normalized, fingerprint: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex') });
}

async function validateStorageRoot(root) {
  const stat = await fs.stat(root).catch((cause) => { throw new LiveProductionError('LIVE_STORAGE_INVALID', `Artifact storage root is unavailable: ${cause.code || cause.message}`); });
  if (!stat.isDirectory()) throw new LiveProductionError('LIVE_STORAGE_INVALID', 'Artifact storage root must be a directory');
  await fs.access(root, fsConstants.R_OK | fsConstants.W_OK).catch((cause) => { throw new LiveProductionError('LIVE_STORAGE_INVALID', `Artifact storage root is not readable/writable: ${cause.code || cause.message}`); });
}

class LiveProductionService {
  constructor({ db, masterOrchestrator, artifactService, storageRoot, storageValidator = validateStorageRoot,
    schemaInspector = inspectSchemaCompatibility, transactionProbe = verifyTransactionalLiveWrites,
    storageProbe = verifyArtifactStorage, mediaExecutionRepository = null, logger = console } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('db is required');
    if (!masterOrchestrator || typeof masterOrchestrator.build !== 'function') throw new Error('masterOrchestrator is required');
    if (!artifactService || typeof artifactService.createVersion !== 'function') throw new Error('artifactService is required');
    this.db = db;
    this.masterOrchestrator = masterOrchestrator;
    this.artifactService = artifactService;
    this.storageRoot = storageRoot;
    this.storageValidator = storageValidator;
    this.schemaInspector = schemaInspector;
    this.transactionProbe = transactionProbe;
    this.storageProbe = storageProbe;
    this.mediaExecutionRepository = mediaExecutionRepository;
    this.logger = logger;
  }

  productionKey(input) { return input.productionKey || input.liveTestKey; }
  productionNamespace(input) { return input.productionNamespace || 'v2.4-live'; }
  productionName(input) { return `${this.productionNamespace(input)}:${this.productionKey(input)}`; }
  jobKey(input) { return `${this.productionNamespace(input)}:${this.productionKey(input)}`; }

  async inspectBrand(brandId) {
    const result = await this.db.query(`/* v2.4:get-brand */
      SELECT b.id, b.name, b.workspace_id AS "workspaceId"
      FROM v2_2.brands b WHERE b.id=$1 AND b.status='ACTIVE'`, [brandId]);
    if (!result.rows[0]) throw new LiveProductionError('LIVE_BRAND_NOT_FOUND', 'Active brand not found');
    return result.rows[0];
  }

  async inspectExisting(input) {
    const result = await this.db.query(`/* v2.4:inspect-existing */
      SELECT p.id AS "productionId", p.status AS "productionStatus", p.metadata,
             j.id AS "jobId", j.status AS "jobStatus", j.payload, j.result
      FROM v2_1.productions p
      LEFT JOIN v2_1.jobs j ON j.production_id=p.id AND j.idempotency_key=$3
      WHERE p.workspace_id=$1 AND p.name=$2`,
    [input.workspaceId, this.productionName(input), this.jobKey(input)]);
    return result.rows[0] || null;
  }

  summary({ brand, input, config, existing, mediaExecutions = [] }) {
    const completedAssets = new Set(mediaExecutions.filter((item) => item.status === 'SUCCEEDED').map((item) => item.asset_id));
    const ambiguousAssets = new Set(mediaExecutions.filter((item) => ['MAY_HAVE_STARTED','NEEDS_RECONCILIATION'].includes(item.status)).map((item) => item.asset_id));
    const pending = existing?.jobStatus === 'COMPLETED' ? [] : input.assetPlan.assets.filter((asset) => (
      !completedAssets.has(asset.asset_id) && !ambiguousAssets.has(asset.asset_id)
    ));
    const videos = input.assetPlan.assets.filter((asset) => asset.kind === 'video');
    const audio = input.assetPlan.assets.filter((asset) => asset.kind === 'voice' || asset.kind === 'audio');
    const videoProfile = videos[0]?.generation_requirements || input.profile || {};
    const audioProfile = audio[0]?.generation_requirements || {};
    return Object.freeze({
      brand: `${brand.name} (${brand.id})`,
      production: existing?.productionId || this.productionName(input),
      productionKey: this.productionKey(input),
      targetDurationSeconds: input.targetDurationSeconds || Number((input.profile.numFrames / input.profile.framesPerSecond).toFixed(3)),
      provider: videoProfile.provider || config.provider,
      model: videoProfile.model || config.model,
      resolution: videoProfile.resolution,
      aspectRatio: videoProfile.aspect_ratio || videoProfile.aspectRatio,
      numFrames: videoProfile.num_frames || videoProfile.numFrames,
      fps: videoProfile.frames_per_second || videoProfile.framesPerSecond,
      expectedVideoGenerations: pending.filter((asset) => asset.kind === 'video').length,
      expectedAudioGenerations: pending.filter((asset) => asset.kind === 'voice' || asset.kind === 'audio').length,
      audioProvider: audioProfile.provider || null,
      audioModel: audioProfile.model || null,
      expectedPaidProviderCalls: pending.length,
      ambiguousProviderExecutions: ambiguousAssets.size,
      masterAssemblyMode: videos.length > 1 || audio.length ? 'ffmpeg-multi-track' : 'ffmpeg-single-visual',
      estimatedCost: null,
      costNote: 'Provider pricing is not encoded in the certified engine; verify current provider pricing before paid execution.',
      paidLiveRun: config.live,
      existingState: existing?.jobStatus || null,
      publicationPolicy: input.publicationPolicy || { requiresHumanApproval: true, autoPublish: false },
      dryRunProviderCalls: 0,
      schemaCompatibility: 'READY',
    });
  }

  async prepare({ input, config }) {
    await this.db.query('/* v2.4:database-health */ SELECT 1');
    await this.storageValidator(this.storageRoot);
    const schemaReport = await this.schemaInspector(this.db);
    assertSchemaCompatible(schemaReport);
    const brand = await this.inspectBrand(input.brandId);
    const scopedInput = { ...input, workspaceId: brand.workspaceId };
    const existing = await this.inspectExisting(scopedInput);
    if (existing?.metadata?.live_input_fingerprint && existing.metadata.live_input_fingerprint !== input.fingerprint) {
      throw new LiveProductionError('LIVE_INPUT_CONFLICT', 'live_test_key already belongs to different structured input');
    }
    const databaseProbe = await this.transactionProbe(this.db, {
      workspaceId: brand.workspaceId, brandId: brand.id, objective: scopedInput.objective,
    });
    let mediaPlanProbe = null;
    let mediaExecutions = [];
    if (input.schemaVersion >= 2) {
      if (!this.mediaExecutionRepository) throw new LiveProductionError('V25_MEDIA_EXECUTION_REQUIRED', 'V2.5 durable media execution repository is required');
      await this.mediaExecutionRepository.inspectSchema();
      mediaPlanProbe = await this.mediaExecutionRepository.verifyTransactionalPlan({
        workspaceId: brand.workspaceId, brandId: brand.id, objective: scopedInput.objective,
        inputFingerprint: input.fingerprint, assets: input.assetPlan.assets,
      });
      if (existing?.productionId) mediaExecutions = await this.mediaExecutionRepository.list(existing.productionId);
    }
    const storageProbe = await this.storageProbe(this.artifactService.storage);
    return { brand, input: scopedInput, existing, schemaReport, databaseProbe, mediaPlanProbe, storageProbe,
      plan: this.summary({ brand, input: scopedInput, config, existing, mediaExecutions }) };
  }

  async findCachedVideo({ input, productionId }) {
    if (typeof this.artifactService.getVersionByIdempotency !== 'function') return null;
    const asset = input.assetPlan.assets[0];
    const mediaFingerprint = canonicalFingerprint({ brandId: input.brandId, productionId, asset });
    return this.artifactService.getVersionByIdempotency({
      artifactId: `brand:${input.brandId}:asset:${asset.asset_id}`,
      type: 'binary',
      idempotencyKey: `${input.brandId}:${productionId}:media:${asset.asset_id}:${mediaFingerprint}`,
      validationStatus: 'pending_master_validation',
    });
  }

  async createAndClaim({ input, config, allowRecoveredRetry = false }) {
    const client = typeof this.db.connect === 'function' ? await this.db.connect() : this.db;
    try {
      await client.query('BEGIN');
      await client.query(`/* v2.4:create-production */
        INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,objective,metadata)
        VALUES($1,$2,$3,'DRAFT',$4,$5::jsonb)
        ON CONFLICT(workspace_id,name) DO NOTHING`,
      [input.workspaceId, input.brandId, this.productionName(input), input.objective, JSON.stringify({
        source: input.schemaVersion >= 2 ? 'v2.5-real-content-cli' : 'v2.4-controlled-live-cli',
        live_test_key: this.productionKey(input), production_key: this.productionKey(input), live_input_fingerprint: input.fingerprint,
        publication_policy: input.publicationPolicy || { requiresHumanApproval: true, autoPublish: false },
      })]);
      const productionResult = await client.query(`/* v2.4:get-production-for-run */
        SELECT * FROM v2_1.productions WHERE workspace_id=$1 AND name=$2 FOR UPDATE`,
      [input.workspaceId, this.productionName(input)]);
      const production = productionResult.rows[0];
      if (!production || production.brand_id !== input.brandId || production.metadata?.live_input_fingerprint !== input.fingerprint) {
        throw new LiveProductionError('LIVE_INPUT_CONFLICT', 'Existing production does not match brand or structured input');
      }
      await client.query(`/* v2.4:create-live-job */
        INSERT INTO v2_1.jobs(production_id,stage,status,idempotency_key,payload)
        VALUES($1,'EDIT','QUEUED',$2,$3::jsonb)
        ON CONFLICT(production_id,idempotency_key) DO NOTHING`,
      [production.id, this.jobKey(input), JSON.stringify({
        source: input.schemaVersion >= 2 ? 'v2.5-real-content-cli' : 'v2.4-controlled-live-cli',
        liveTestKey: this.productionKey(input), productionKey: this.productionKey(input), inputFingerprint: input.fingerprint,
        provider: config.provider, model: config.model, providerRequestState: 'NOT_STARTED',
      })]);
      const jobResult = await client.query(`/* v2.4:get-live-job */
        SELECT * FROM v2_1.jobs WHERE production_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [production.id, this.jobKey(input)]);
      const job = jobResult.rows[0];
      if (job.status === 'COMPLETED') {
        await client.query('COMMIT');
        return { production, job, reused: true };
      }
      if (job.status !== 'QUEUED' && !(job.status === 'RETRYING' && allowRecoveredRetry)) {
        throw new LiveProductionError('LIVE_RUN_NOT_RETRYABLE', `Existing live run is ${job.status}; use recovery tooling or a new explicit live_test_key`, { productionId: production.id, jobId: job.id });
      }
      const claimed = await client.query(`/* v2.4:claim-live-job */
        UPDATE v2_1.jobs SET status='RUNNING', worker_id=$2, started_at=coalesce(started_at,now()),
          lease_expires_at=now()+interval '30 minutes', heartbeat_at=now(), completed_at=NULL, updated_at=now()
        WHERE id=$1 AND status IN ('QUEUED','RETRYING')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now()) RETURNING *`, [job.id, config.workerId]);
      if (!claimed.rows[0]) throw new LiveProductionError('LIVE_RUN_NOT_CLAIMED', 'Live production job was claimed by another operator');
      await client.query(`UPDATE v2_1.productions SET status='RUNNING', started_at=coalesce(started_at,now()), updated_at=now() WHERE id=$1`, [production.id]);
      await client.query('COMMIT');
      return { production, job: claimed.rows[0], reused: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (client !== this.db) client.release();
    }
  }

  async complete({ productionId, jobId, workerId, result }) {
    const completed = await this.db.query(`/* v2.4:complete-live-job */
      UPDATE v2_1.jobs SET status='COMPLETED', result=$4::jsonb, worker_id=NULL, lease_expires_at=NULL,
        heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=$1 AND production_id=$2 AND worker_id=$3 AND status='RUNNING' RETURNING *`,
    [jobId, productionId, workerId, JSON.stringify(result)]);
    if (!completed.rows[0]) throw new LiveProductionError('LIVE_JOB_FENCED', 'Live job ownership was lost before completion');
    await this.db.query(`UPDATE v2_1.productions SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1 AND status='RUNNING'`, [productionId]);
  }

  async markProviderBoundary({ productionId, jobId, workerId }) {
    const marked = await this.db.query(`/* v2.4:mark-provider-boundary */
      UPDATE v2_1.jobs SET payload=coalesce(payload,'{}'::jsonb) || $4::jsonb, heartbeat_at=now(), updated_at=now()
      WHERE id=$1 AND production_id=$2 AND worker_id=$3 AND status='RUNNING' RETURNING *`,
    [jobId, productionId, workerId, JSON.stringify({ providerRequestState: 'MAY_HAVE_STARTED', providerBoundaryAt: new Date().toISOString() })]);
    if (!marked.rows[0]) throw new LiveProductionError('LIVE_JOB_FENCED', 'Live job ownership was lost before provider boundary');
  }

  async fail({ productionId, jobId, workerId, error, providerBoundaryCrossed, durableAssetRecovery = false }) {
    const retryableBeforeProvider = providerBoundaryCrossed !== true || durableAssetRecovery;
    await this.db.query(`/* v2.4:fail-live-job */
      UPDATE v2_1.jobs SET status=$5, error=$4::jsonb, worker_id=NULL, lease_expires_at=NULL,
        heartbeat_at=now(), completed_at=CASE WHEN $5='FAILED' THEN now() ELSE NULL END, updated_at=now()
      WHERE id=$1 AND production_id=$2 AND worker_id=$3 AND status='RUNNING'`,
    [jobId, productionId, workerId, JSON.stringify({ code: error.code || 'LIVE_PRODUCTION_FAILED', message: error.message,
      details: error.details || null, providerBoundaryCrossed: providerBoundaryCrossed === true,
      durableAssetRecovery }), retryableBeforeProvider ? 'RETRYING' : 'FAILED']);
    if (!retryableBeforeProvider) {
      await this.db.query(`UPDATE v2_1.productions SET status='FAILED', completed_at=now(), updated_at=now() WHERE id=$1 AND status='RUNNING'`, [productionId]);
    }
  }

  async run({ input, config }) {
    const prepared = await this.prepare({ input, config });
    this.logger.info?.('Controlled live production plan', prepared.plan);
    if (!config.live) return { dryRun: true, plan: prepared.plan };

    let allowRecoveredRetry = false;
    if (prepared.existing?.jobStatus === 'RETRYING') {
      if (input.schemaVersion >= 2) {
        allowRecoveredRetry = true;
      } else if (prepared.existing.payload?.providerRequestState === 'NOT_STARTED') {
        allowRecoveredRetry = true;
      } else {
        const cachedVideo = await this.findCachedVideo({ input: prepared.input, productionId: prepared.existing.productionId });
        if (!cachedVideo) {
          throw new LiveProductionError('LIVE_EXISTING_PREDICTION_UNRESOLVED',
            'Recovered run may have crossed the provider boundary and has no completed immutable video artifact; refusing a second paid prediction', prepared.existing);
        }
        allowRecoveredRetry = true;
      }
    }
    const claimed = await this.createAndClaim({ input: prepared.input, config, allowRecoveredRetry });
    if (claimed.reused) return { ...claimed.job.result, reused: true, paidGenerationPerformed: false };
    let providerBoundaryCrossed = false;
    try {
      const inputArtifact = await this.artifactService.createVersion({
        artifactId: `production:${claimed.production.id}:live-input`,
        type: 'text',
        content: JSON.stringify({
          schemaVersion: input.schemaVersion || 1, brandId: input.brandId,
          productionKey: this.productionKey(input), objective: input.objective,
          targetPlatform: input.targetPlatform || null, targetDurationSeconds: input.targetDurationSeconds || null,
          publicationPolicy: input.publicationPolicy || { requiresHumanApproval: true, autoPublish: false },
          script: input.script, shotPlan: input.shotPlan, assetPlan: input.assetPlan,
        }),
        idempotencyKey: `${input.brandId}:${claimed.production.id}:live-input:${input.fingerprint}`,
        provider: 'operator', model: input.schemaVersion >= 2 ? 'v2.5-real-content-input' : 'v2.4-structured-live-input', validationStatus: 'validated',
      });
      await this.markProviderBoundary({ productionId: claimed.production.id, jobId: claimed.job.id, workerId: config.workerId });
      providerBoundaryCrossed = true;
      const masterResult = await this.masterOrchestrator.build({
        productionId: claimed.production.id,
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        workerId: config.workerId,
        script: input.script,
        shotPlan: input.shotPlan,
        assetPlan: input.assetPlan,
        qualityPolicy: { requireVoiceForSpokenCopy: input.schemaVersion >= 2 && input.voiceover?.enabled === true },
      });
      const mediaResults = [...new Map(masterResult.assembly.clips.map((clip) => [clip.media.assetId, clip.media])).values()];
      const videoMedia = mediaResults.find((media) => media.kind === 'video' || media.kind === 'image') || mediaResults[0];
      const audioMedia = mediaResults.find((media) => media.kind === 'voice' || media.kind === 'audio');
      if (masterResult.quality.status !== 'PASS' || !masterResult.quality.readyForHumanReview) {
        throw new LiveProductionError('LIVE_MASTER_VALIDATION_FAILED', 'Master failed required quality validation', {
          quality: masterResult.quality,
          inputArtifact: { id: inputArtifact.artifactId, version: inputArtifact.version, storageKey: inputArtifact.storageKey },
          masterArtifact: { id: masterResult.master.artifact.artifactId, version: masterResult.master.artifact.version, storageKey: masterResult.master.artifact.storageKey },
        });
      }
      const review = await this.db.query(`/* v2.4:get-pending-review */
        SELECT ri.id, CASE WHEN rd.id IS NULL THEN 'AWAITING_HUMAN_APPROVAL' ELSE rd.decision END AS status
        FROM v2_3.master_review_items ri
        LEFT JOIN v2_3.master_review_decisions rd ON rd.review_item_id=ri.id
        WHERE ri.production_id=$1 AND ri.brand_id=$2 AND ri.master_storage_key=$3`,
      [claimed.production.id, input.brandId, masterResult.master.artifact.storageKey]);
      if (!review.rows[0] || review.rows[0].status !== 'AWAITING_HUMAN_APPROVAL') {
        throw new LiveProductionError('LIVE_REVIEW_NOT_PENDING', 'Exact master was not registered as pending human review');
      }
      const result = {
        productionId: claimed.production.id,
        brandId: input.brandId,
        productionKey: this.productionKey(input),
        inputArtifact: { id: inputArtifact.artifactId, version: inputArtifact.version, storageKey: inputArtifact.storageKey },
        videoArtifact: videoMedia ? { id: videoMedia.artifact.artifactId, version: videoMedia.artifact.version, storageKey: videoMedia.artifact.storageKey } : null,
        videoArtifacts: mediaResults.filter((media) => media.kind === 'video').map((media) => ({
          assetId: media.assetId, id: media.artifact.artifactId, version: media.artifact.version,
          storageKey: media.artifact.storageKey, provider: media.provider, model: media.model,
          requestId: media.requestId || media.provenance?.predictionId || null,
        })),
        audioArtifact: audioMedia ? { assetId: audioMedia.assetId, id: audioMedia.artifact.artifactId,
          version: audioMedia.artifact.version, storageKey: audioMedia.artifact.storageKey,
          provider: audioMedia.provider, model: audioMedia.model, requestId: audioMedia.requestId || null } : null,
        masterArtifact: { id: masterResult.master.artifact.artifactId, version: masterResult.master.artifact.version, storageKey: masterResult.master.artifact.storageKey },
        masterProbe: masterResult.master.probe,
        mediaValidation: masterResult.mediaValidation || null,
        validationStatus: masterResult.quality.status,
        reviewStatus: review.rows[0].status,
        reviewItemId: review.rows[0].id,
        provider: videoMedia?.provider || null,
        model: videoMedia?.model || null,
        predictionId: videoMedia?.provenance?.predictionId || videoMedia?.requestId || null,
        paidGenerationPerformed: mediaResults.some((media) => media.provenance?.source !== 'immutable-artifact-cache'),
        publicationTriggered: false,
      };
      await this.complete({ productionId: claimed.production.id, jobId: claimed.job.id, workerId: config.workerId, result });
      return result;
    } catch (error) {
      await this.fail({ productionId: claimed.production.id, jobId: claimed.job.id, workerId: config.workerId,
        error, providerBoundaryCrossed, durableAssetRecovery: input.schemaVersion >= 2 });
      throw error;
    }
  }
}

module.exports = {
  LiveProductionError,
  LiveProductionService,
  buildStructuredLiveInput,
  resolveLiveConfiguration,
  validateStorageRoot,
};
