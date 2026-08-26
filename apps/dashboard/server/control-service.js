'use strict';

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
  return [
    { key: 'planning', label: 'Planning', status: item.jobId ? 'COMPLETED' : 'PENDING' },
    { key: 'generation', label: 'Provider Generation', status: providerCompleted ? 'COMPLETED'
      : item.jobStatus === 'RUNNING' ? 'RUNNING' : terminalFailure ? 'FAILED' : 'PENDING' },
    { key: 'assembly', label: 'Master Assembly', status: masterIdentity ? 'COMPLETED'
      : item.jobStatus === 'RUNNING' && providerCompleted ? 'RUNNING' : terminalFailure ? 'FAILED' : 'PENDING' },
    { key: 'validation', label: 'Validation', status: item.validationStatus === 'PASS' ? 'COMPLETED'
      : item.validationStatus ? 'FAILED' : 'PENDING' },
    { key: 'review', label: 'Human Review', status: ['APPROVED','REJECTED'].includes(item.reviewState) ? 'COMPLETED'
      : item.reviewState === 'AWAITING_HUMAN_APPROVAL' ? 'RUNNING'
        : item.reviewState === 'BLOCKED' || item.validationStatus === 'FAIL' ? 'BLOCKED' : 'PENDING' },
  ];
}

class ControlService {
  constructor({ repository, reviewService, commandService = null, storage, providers, providerCatalog = null, actor = 'local-operator' } = {}) {
    if (!repository) throw new Error('repository is required');
    if (!reviewService) throw new Error('reviewService is required');
    if (!storage) throw new Error('storage is required');
    this.repository = repository;
    this.reviewService = reviewService;
    this.commandService = commandService;
    this.storage = storage;
    this.providers = providers || [];
    this.providerCatalog = providerCatalog;
    this.actor = actor;
  }

  async health() { return { status: 'ok', database: await this.repository.health() }; }
  async overview() { return this.repository.overview(); }
  async listBrands() { return this.repository.listBrands(); }
  async listProviders() { return this.providerCatalog ? this.providerCatalog.snapshot() : this.providers; }

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
    return { ...item, operationalStatus: operationalStatus(item), progress: progressFor(item), shotRegenerations,
      actualProviderCalls: execution.actualProviderCalls, ambiguousExecutions: execution.ambiguousExecutions,
      autoPublish: false };
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

module.exports = { ControlService, ControlError, UUID_PATTERN, operationalStatus, progressFor };
