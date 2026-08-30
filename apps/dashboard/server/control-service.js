'use strict';

const { publicMediaStackCatalog } = require('../../../src/v2.9.2/media-stack');
const { partialMediaPlan, reusableSemanticPass, retryPlan,
  sourceArtifactFromExecution } = require('../../../src/v2.9/semantic-evaluation-retry');
const { operatorInputFromRaw } = require('../../../src/v2.7/production-command-service');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_STATUSES = new Set(['DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED']);
const RENDER_MODES = new Set(['FAST','QUALITY']);

class ControlError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ControlError';
    this.status = status;
    this.code = code;
  }
}

function optionalUuid(name, value) {
  if (value === undefined || value === null || value === '') return null;
  if (!UUID_PATTERN.test(value)) throw new ControlError(400, 'MALFORMED_ID', `${name} must be a UUID`);
  return value;
}

function requiredUuid(name, value) {
  const parsed = optionalUuid(name, value);
  if (!parsed) throw new ControlError(400, 'MALFORMED_ID', `${name} is required`);
  return parsed;
}

function operationalStatus(item) {
  if (item.reviewState === 'APPROVED') return 'APPROVED';
  if (item.reviewState === 'REJECTED') return 'REJECTED';
  if (item.reviewState === 'AWAITING_HUMAN_APPROVAL') return 'AWAITING_REVIEW';
  if (item.validationStatus === 'FAIL') return 'VALIDATION_FAILED';
  if (item.jobStatus === 'RETRYING') return 'FAILED_RETRYABLE';
  if (item.jobStatus === 'DEAD_LETTER') return 'FAILED';
  if (item.jobStatus === 'RUNNING') return 'RUNNING';
  if (item.status === 'DRAFT' && item.jobStatus === 'QUEUED') return 'PREFLIGHT_READY';
  return item.status;
}

function progressFor(item) {
  const state = operationalStatus(item);
  const terminalFailure = ['FAILED','FAILED_RETRYABLE','VALIDATION_FAILED','CANCELLED'].includes(state);
  const validationReached = Boolean(item.validationStatus);
  const masterIdentity = item.validationEvidence?.masterArtifact || item.jobResult?.masterArtifact || null;
  const providerCompleted = validationReached || Boolean(masterIdentity) || item.jobStatus === 'COMPLETED';
  const lifecycle = item.qualityLifecycle || item.validationEvidence?.lifecycle
    || item.jobError?.details?.quality?.lifecycle || item.jobError?.validation?.lifecycle || {};
  const stage = (value, fallback = 'PENDING') => value === 'PASS' ? 'COMPLETED'
    : value === 'WARN' ? 'WARN' : value === 'FAIL' ? 'FAILED'
      : value === 'AWAITING' ? 'RUNNING' : value === 'BLOCKED' ? 'BLOCKED'
        : value === 'NOT_STARTED' ? 'PENDING' : fallback;
  return [
    { key: 'pre-execution', label: 'Pre-Execution', status: stage(lifecycle.preExecution, item.jobId ? 'COMPLETED' : 'PENDING') },
    { key: 'generation', label: 'Provider Generation', status: stage(lifecycle.providerGeneration, providerCompleted ? 'COMPLETED'
      : item.jobStatus === 'RUNNING' ? 'RUNNING' : terminalFailure ? 'FAILED' : 'PENDING') },
    { key: 'source-technical', label: 'Source Technical', status: stage(lifecycle.sourceTechnical) },
    { key: 'source-visual', label: 'Source Visual', status: stage(lifecycle.sourceVisual) },
    { key: 'temporal-quality', label: 'Temporal Quality', status: stage(lifecycle.temporalQuality) },
    { key: 'creative-compliance', label: 'Creative Compliance', status: stage(lifecycle.creativeCompliance) },
    { key: 'assembly', label: 'Master Assembly', status: stage(lifecycle.masterAssembly, masterIdentity ? 'COMPLETED'
      : lifecycle.sourceVisual === 'FAIL' ? 'BLOCKED' : item.jobStatus === 'RUNNING' && providerCompleted ? 'RUNNING' : terminalFailure ? 'FAILED' : 'PENDING') },
    { key: 'master-technical', label: 'Master Technical', status: stage(lifecycle.masterTechnical) },
    { key: 'final-quality', label: 'Final Quality', status: stage(lifecycle.finalQuality,
      item.validationStatus === 'PASS' ? 'COMPLETED' : item.validationStatus === 'WARN' ? 'WARN' : item.validationStatus ? 'FAILED' : 'PENDING') },
    { key: 'review', label: 'Human Review', status: ['APPROVED','REJECTED'].includes(item.reviewState) ? 'COMPLETED'
      : item.reviewState === 'AWAITING_HUMAN_APPROVAL' ? 'RUNNING'
        : item.reviewState === 'BLOCKED' || item.validationStatus === 'FAIL' ? 'BLOCKED' : 'PENDING' },
  ];
}

function evaluatorAccounting(item) {
  // Error details retain the full durable quality object, including evaluator call accounting.
  // The compact validation summary intentionally omits that metadata, so it must not shadow durable truth.
  const quality = item.jobError?.details?.quality || item.jobResult?.quality || item.validationEvidence || null;
  const accounting = quality?.metadata?.externalCallAccounting || {};
  return Object.freeze({
    actualSemanticEvaluations: Number(accounting.semanticVisualEvaluations || 0),
    actualSourceSemanticEvaluations: Number(accounting.sourceSemanticEvaluations || 0),
    actualFinalSemanticEvaluations: Number(accounting.finalSemanticEvaluations || 0),
    actualContinuityEvaluations: Number(accounting.continuityEvaluations || 0),
    actualEvaluatorCalls: Number(accounting.totalEvaluatorCalls || 0),
  });
}

class ControlService {
  constructor({ repository, reviewService, commandService = null, qualityRecoveryService = null, storage,
    providers, providerCatalog = null, actor = 'local-operator', env = process.env } = {}) {
    if (!repository) throw new Error('repository is required');
    if (!reviewService) throw new Error('reviewService is required');
    if (!storage) throw new Error('storage is required');
    this.repository = repository;
    this.reviewService = reviewService;
    this.commandService = commandService;
    this.qualityRecoveryService = qualityRecoveryService;
    this.storage = storage;
    this.providers = providers || [];
    this.providerCatalog = providerCatalog;
    this.actor = actor;
    this.env = env;
  }

  async health() { return { status: 'ok', database: await this.repository.health() }; }
  async overview() { return this.repository.overview(); }
  async listBrands() { return this.repository.listBrands(); }
  async listProviders() {
    if (!this.providerCatalog) return this.providers;
    const catalog = await this.providerCatalog.snapshot();
    return [...catalog, ...this.providers.filter((item) => item.capability === 'SEMANTIC VISUAL QA')];
  }

  async mediaStackCatalog() {
    if (!this.providerCatalog) throw new ControlError(503, 'CATALOG_UNAVAILABLE', 'Universal media catalog is unavailable');
    await this.providerCatalog.refresh();
    return publicMediaStackCatalog(this.providerCatalog);
  }

  async addProviderModel({ brandId, provider, modelId, displayName, preset }) {
    if (!this.providerCatalog) throw new ControlError(503, 'CATALOG_PERSISTENCE_UNAVAILABLE', 'Provider catalog is unavailable');
    const brand = await this.repository.getBrand(requiredUuid('brandId', brandId));
    if (!brand?.workspaceId) throw new ControlError(404, 'BRAND_NOT_FOUND', 'Active brand workspace was not found');
    try { return await this.providerCatalog.addModel({ workspaceId: brand.workspaceId, provider, modelId, displayName, preset }); }
    catch (error) { if (error.status) throw new ControlError(error.status, error.code, error.message); throw error; }
  }

  async getBrand(brandId) {
    const item = await this.repository.getBrand(requiredUuid('brandId', brandId));
    if (!item) throw new ControlError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return item;
  }

  async listProductions({ brandId, status, renderMode, needsReview = false, failed = false } = {}) {
    const scope = optionalUuid('brandId', brandId);
    if (status && !PRODUCTION_STATUSES.has(status)) throw new ControlError(400, 'INVALID_STATUS', 'Invalid production status');
    const mode = renderMode ? String(renderMode).toUpperCase() : null;
    if (mode && !RENDER_MODES.has(mode)) throw new ControlError(400, 'INVALID_RENDER_MODE', 'Invalid render mode');
    const items = await this.repository.listProductions({ brandId: scope, status: status || null,
      renderMode: mode, needsReview: needsReview === true, failed: failed === true });
    return items.map((item) => ({ ...item, operationalStatus: operationalStatus(item) }));
  }

  async production(productionId, brandId) {
    const item = await this.repository.getProduction(requiredUuid('productionId', productionId), optionalUuid('brandId', brandId));
    if (!item) throw new ControlError(404, 'PRODUCTION_NOT_FOUND', 'Production not found in brand scope');
    const execution = typeof this.repository.executionSafety === 'function'
      ? await this.repository.executionSafety(item.id) : { ambiguousExecutions: 0, actualProviderCalls: 0 };
    const shotRegenerations = typeof this.repository.listShotRegenerations === 'function'
      ? await this.repository.listShotRegenerations(item.id, item.brandId) : [];
    const evaluator = evaluatorAccounting(item);
    let semanticRetry = retryPlan(item);
    if (semanticRetry.eligible && item.jobPayload?.canonicalRawInput) {
      try {
        const input = operatorInputFromRaw(item.jobPayload.canonicalRawInput);
        semanticRetry = retryPlan(item, input);
        const executions = typeof this.repository.semanticRetryMediaExecutions === 'function'
          ? await this.repository.semanticRetryMediaExecutions(item.id, item.brandId) : [];
        const sourceExecution = executions.find((row) => String(row.asset_id || row.assetId) === semanticRetry.assetId);
        const latestAttempt = typeof this.repository.latestSemanticRetryAttempt === 'function'
          ? await this.repository.latestSemanticRetryAttempt(item.id, item.brandId, semanticRetry.assetId) : null;
        const semanticPass = reusableSemanticPass({ attempt: latestAttempt,
          sourceArtifact: sourceArtifactFromExecution(sourceExecution),
          previousEvidenceArtifact: semanticRetry.previousEvidenceArtifact,
          evaluator: { provider: String(this.env.SEMANTIC_VISUAL_PROVIDER || '').toLowerCase(),
            model: this.env.SEMANTIC_VISUAL_MODEL } });
        semanticRetry = Object.freeze({ ...semanticRetry,
          expectedSemanticEvaluations: semanticPass.reusable ? 0 : 1,
          semanticPass: Object.freeze({ reused: semanticPass.reusable, attempt: semanticPass.attempt }),
          media: partialMediaPlan({ input, sourceAssetId: semanticRetry.assetId, executions }) });
      }
      catch { semanticRetry = Object.freeze({ ...semanticRetry, eligible: false, action: null }); }
    }
    let qualityRecovery = null;
    if (this.qualityRecoveryService) {
      try { qualityRecovery = await this.qualityRecoveryService.inspect({ productionId: item.id, brandId: item.brandId, production: item }); }
      catch (error) { qualityRecovery = Object.freeze({ eligible: false, status: 'BLOCKED',
        action: null, reason: error.message, code: error.code || 'QUALITY_RECOVERY_INSPECTION_FAILED' }); }
    }
    return { ...item, operationalStatus: operationalStatus(item), progress: progressFor(item), shotRegenerations,
      actualProviderCalls: execution.actualProviderCalls, ambiguousExecutions: execution.ambiguousExecutions,
      ...evaluator, actualExternalCalls: execution.actualProviderCalls + evaluator.actualEvaluatorCalls,
      semanticRetry, qualityRecovery, autoPublish: false };
  }

  async stages(productionId, brandId) {
    await this.production(productionId, brandId);
    return this.repository.listStages(productionId, optionalUuid('brandId', brandId));
  }

  async artifacts(productionId, brandId) {
    await this.production(productionId, brandId);
    return this.repository.listArtifacts(productionId, optionalUuid('brandId', brandId));
  }

  async reviews({ brandId, includeDecided = false } = {}) {
    return this.repository.listReviews({ brandId: optionalUuid('brandId', brandId), includeDecided: includeDecided === true });
  }

  async decide({ reviewItemId, brandId, decision, reason }) {
    try {
      return await this.reviewService.decide({
        reviewItemId: requiredUuid('reviewItemId', reviewItemId),
        brandId: requiredUuid('brandId', brandId),
        decision,
        actor: this.actor,
        reason,
      });
    } catch (error) {
      if (error.code === 'REVIEW_NOT_FOUND') throw new ControlError(404, error.code, 'Review item not found in brand scope');
      if (error.code === 'REVIEW_DECISION_CONFLICT') throw new ControlError(409, error.code, error.message);
      throw error;
    }
  }

  requireCommands() {
    if (!this.commandService) throw new ControlError(503, 'PRODUCTION_COMMANDS_UNAVAILABLE', 'Production commands are not configured');
    return this.commandService;
  }

  requireQualityRecovery() {
    if (!this.qualityRecoveryService) throw new ControlError(503, 'QUALITY_RECOVERY_UNAVAILABLE',
      'Quality evidence recovery is not configured');
    return this.qualityRecoveryService;
  }

  async preflightProduction(body) { return this.requireCommands().preflight(body); }

  async createProduction(body) {
    return this.requireCommands().create(body.request, { preflightId: body.preflightId });
  }

  async startProduction({ productionId, brandId, confirmation }) {
    return this.requireCommands().start({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), confirmation });
  }

  async retryProduction({ productionId, brandId }) {
    return this.requireCommands().retry({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId) });
  }

  async preflightQualityRecovery({ productionId, brandId }) {
    return this.requireQualityRecovery().preflight({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId) });
  }

  async recoverQualityEvidence({ productionId, brandId, confirmation }) {
    return this.requireQualityRecovery().recover({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), confirmation });
  }

  async preflightSemanticRetry({ productionId, brandId }) {
    return this.requireCommands().preflightSemanticRetry({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId) });
  }

  async retrySemanticEvaluation({ productionId, brandId, confirmation }) {
    return this.requireCommands().retrySemanticEvaluation({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), confirmation });
  }

  async regenerateProduction({ productionId, brandId, requestId, reason }) {
    return this.requireCommands().regenerate({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), requestId: requiredUuid('requestId', requestId), reason });
  }

  async preflightShotRegeneration({ productionId, brandId, shotId, requestId, instruction }) {
    return this.requireCommands().preflightShotRegeneration({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), shotId, requestId: requiredUuid('requestId', requestId), instruction });
  }

  async regenerateShot({ productionId, brandId, shotId, requestId, instruction, preflightId, confirmation }) {
    return this.requireCommands().regenerateShot({ productionId: requiredUuid('productionId', productionId),
      brandId: requiredUuid('brandId', brandId), shotId, requestId: requiredUuid('requestId', requestId),
      instruction, preflightId, confirmation });
  }

  async artifactContent({ sourceId, artifactId, version, brandId }) {
    const parsedVersion = Number(version);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) throw new ControlError(400, 'INVALID_VERSION', 'version must be a positive integer');
    if (typeof artifactId !== 'string' || artifactId.length < 1 || artifactId.length > 256) {
      throw new ControlError(400, 'INVALID_ARTIFACT_ID', 'artifactId is invalid');
    }
    const descriptor = await this.repository.resolveArtifact({
      sourceId: requiredUuid('sourceId', sourceId), artifactId, version: parsedVersion,
      brandId: requiredUuid('brandId', brandId),
    });
    if (!descriptor) throw new ControlError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found in brand scope');
    const bytes = await this.storage.get({ key: descriptor.storageKey });
    return { bytes, contentType: descriptor.contentType || 'application/octet-stream' };
  }
}

module.exports = { ControlService, ControlError, UUID_PATTERN, evaluatorAccounting, operationalStatus, progressFor };
