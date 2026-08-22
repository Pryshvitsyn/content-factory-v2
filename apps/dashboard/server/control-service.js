'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_STATUSES = new Set(['DRAFT','RUNNING','COMPLETED','FAILED','CANCELLED']);

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

class ControlService {
  constructor({ repository, reviewService, storage, providers, actor = 'local-operator' } = {}) {
    if (!repository) throw new Error('repository is required');
    if (!reviewService) throw new Error('reviewService is required');
    if (!storage) throw new Error('storage is required');
    this.repository = repository;
    this.reviewService = reviewService;
    this.storage = storage;
    this.providers = providers || [];
    this.actor = actor;
  }

  async health() { return { status: 'ok', database: await this.repository.health() }; }
  async overview() { return this.repository.overview(); }
  async listBrands() { return this.repository.listBrands(); }

  async getBrand(brandId) {
    const item = await this.repository.getBrand(requiredUuid('brandId', brandId));
    if (!item) throw new ControlError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return item;
  }

  async listProductions({ brandId, status } = {}) {
    const scope = optionalUuid('brandId', brandId);
    if (status && !PRODUCTION_STATUSES.has(status)) throw new ControlError(400, 'INVALID_STATUS', 'Invalid production status');
    return this.repository.listProductions({ brandId: scope, status: status || null });
  }

  async production(productionId, brandId) {
    const item = await this.repository.getProduction(requiredUuid('productionId', productionId), optionalUuid('brandId', brandId));
    if (!item) throw new ControlError(404, 'PRODUCTION_NOT_FOUND', 'Production not found in brand scope');
    return item;
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

module.exports = { ControlService, ControlError, UUID_PATTERN };
