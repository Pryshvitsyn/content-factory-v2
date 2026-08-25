'use strict';

const { PROVIDERS, MODELS } = require('./provider-definitions');
const { normalizeCapability } = require('./capabilities');

const AVAILABILITY = Object.freeze(['NOT_CONFIGURED','CONFIGURED_NOT_PROBED','READY','DEGRADED','UNAVAILABLE','EXPERIMENTAL']);
const PRESETS = Object.freeze({
  VIDEO_STANDARD: { capabilities: ['TEXT_TO_VIDEO'], profiles: ['STANDARD'], experimental: true },
  VIDEO_T2V_I2V: { capabilities: ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO'], profiles: ['ECONOMY','STANDARD','PREMIUM'], experimental: true },
});

class ProviderCatalogError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = 'ProviderCatalogError'; this.code = code; this.status = 409; this.details = details;
  }
}

function credentialConfigured(provider, env) {
  if (!provider.credentialEnv) {
    return provider.id === 'moneyprinterturbo'
      ? env.MPT_ENABLED === 'true' && Boolean(env.MPT_BASE_URL) && env.MPT_AUTO_PUBLISH_DISABLED === 'true'
      : true;
  }
  return [provider.credentialEnv, ...(provider.credentialAliases || [])].some((name) => Boolean(env[name]));
}

function availability(provider, env) {
  if (!credentialConfigured(provider, env)) return 'NOT_CONFIGURED';
  const override = String(env[`PROVIDER_${provider.id.toUpperCase()}_HEALTH`] || '').toUpperCase();
  return AVAILABILITY.includes(override) ? override : 'CONFIGURED_NOT_PROBED';
}

function clone(value) { return structuredClone(value); }

class PostgresProviderCatalogRepository {
  constructor({ db } = {}) { if (!db?.query) throw new Error('db is required'); this.db = db; }
  async listModels(workspaceId = null) {
    try {
      const result = await this.db.query(`/* v2.8:list-provider-models */
        SELECT workspace_id AS "workspaceId",provider,vendor,model_id AS "modelId",display_name AS "displayName",
          adapter_family AS "adapterFamily",capabilities,profile_preset AS "profilePreset",enabled,experimental
        FROM v2_8.provider_models WHERE workspace_id IS NULL OR workspace_id=$1 ORDER BY created_at,id`, [workspaceId]);
      return result.rows;
    } catch (error) {
      if (error.code === '42P01' || error.code === '3F000') return [];
      throw error;
    }
  }
  async addModel({ workspaceId, provider, modelId, displayName = null, preset = 'VIDEO_STANDARD' }) {
    const providerDefinition = PROVIDERS.find((item) => item.id === provider);
    const definition = PRESETS[preset];
    if (!providerDefinition || !['fal','replicate'].includes(provider)) {
      throw new ProviderCatalogError('SELECTED_PROVIDER_UNAVAILABLE', 'Dashboard model registration is limited to supported aggregator adapter families');
    }
    if (!definition) throw new ProviderCatalogError('SELECTED_PROFILE_UNAVAILABLE', 'Unknown safe model preset');
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,191}$/.test(modelId || '')) throw new ProviderCatalogError('SELECTED_MODEL_UNAVAILABLE', 'modelId is invalid');
    const vendor = modelId.split('/')[0];
    const result = await this.db.query(`/* v2.8:add-provider-model */
      INSERT INTO v2_8.provider_models
        (workspace_id,provider,vendor,model_id,display_name,adapter_family,capabilities,profile_preset,enabled,experimental)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,true,$9)
      ON CONFLICT(workspace_id,provider,model_id) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()
      RETURNING id,workspace_id AS "workspaceId",provider,vendor,model_id AS "modelId",display_name AS "displayName",
        adapter_family AS "adapterFamily",capabilities,profile_preset AS "profilePreset",enabled,experimental`,
    [workspaceId || null, provider, vendor, modelId, displayName || modelId, providerDefinition.adapterFamily,
      JSON.stringify(definition.capabilities), preset, definition.experimental]);
    return result.rows[0];
  }
}

class ProviderCatalog {
  constructor({ env = process.env, repository = null, workspaceId = null, providers = PROVIDERS, models = MODELS } = {}) {
    this.env = env; this.repository = repository; this.workspaceId = workspaceId;
    this.providers = clone(providers); this.builtinModels = clone(models); this.customModels = [];
  }

  async refresh(workspaceId = this.workspaceId) {
    this.workspaceId = workspaceId || null;
    this.customModels = this.repository ? await this.repository.listModels(this.workspaceId) : [];
    return this;
  }
  async forWorkspace(workspaceId) {
    if (!workspaceId) throw new ProviderCatalogError('WORKSPACE_SCOPE_REQUIRED', 'Workspace scope is required for provider catalog resolution');
    const scoped = new ProviderCatalog({ env: this.env, repository: this.repository, workspaceId,
      providers: this.providers, models: this.builtinModels });
    await scoped.refresh(workspaceId); return scoped;
  }

  modelFromCustom(row) {
    const preset = PRESETS[row.profilePreset] || PRESETS.VIDEO_STANDARD;
    return { ...row, vendor: row.vendor || row.modelId.split('/')[0], displayName: row.displayName || row.modelId,
      profiles: Object.fromEntries(preset.profiles.map((name) => [name, { resolution: name === 'PREMIUM' ? '1080p' : '720p' }])),
      capabilities: row.capabilities || preset.capabilities, enabled: row.enabled !== false,
      constraints: { durations: [5], resolutions: ['720p','1080p'], aspectRatios: ['9:16','16:9'] },
      experimental: row.experimental !== false, costStatus: 'UNKNOWN', source: 'workspace-registration' };
  }

  allModels() { return [...this.builtinModels, ...this.customModels.map((row) => this.modelFromCustom(row))]; }
  listProviders() {
    return this.providers.map((provider) => {
      const models = this.listModels(provider.id);
      const configured = credentialConfigured(provider, this.env);
      return Object.freeze({ id: provider.id, provider: provider.displayName, displayName: provider.displayName,
        type: provider.type, adapterFamily: provider.adapterFamily, configured,
        credentialStatus: configured ? 'CONFIGURED' : 'NOT_CONFIGURED', availability: availability(provider, this.env),
        productionStatus: provider.productionStatus, modelCount: models.length,
        capabilities: [...new Set(models.flatMap((model) => model.capabilities))].sort(), models });
    });
  }
  listModels(provider) { return this.allModels().filter((model) => model.provider === String(provider).toLowerCase() && model.enabled !== false)
    .map((model) => Object.freeze({ ...clone(model), selectable: model.experimental !== true || this.env.V28_ALLOW_EXPERIMENTAL_MODELS === 'true' })); }
  listProfiles(provider, modelId) {
    const model = this.listModels(provider).find((item) => item.modelId === modelId);
    if (!model) return [];
    return Object.entries(model.profiles || {}).map(([name, settings]) => Object.freeze({ name, settings: clone(settings) }));
  }
  getCapabilities(provider, modelId) {
    return this.listModels(provider).find((model) => model.modelId === modelId)?.capabilities || [];
  }
  getAvailability(provider) {
    const item = this.providers.find((entry) => entry.id === String(provider).toLowerCase());
    return item ? availability(item, this.env) : 'UNAVAILABLE';
  }
  validateSelection(selection) { return this.resolveSelection(selection); }
  resolveSelection({ provider, model, profile, capability = 'TEXT_TO_VIDEO', durationSeconds = null,
    resolution = null, aspectRatio = null, allowExperimental = false } = {}) {
    const providerId = String(provider || '').toLowerCase();
    if (!providerId || providerId === 'auto') throw new ProviderCatalogError('SELECTED_PROVIDER_UNAVAILABLE', 'Select an explicit provider; AUTO paid routing is disabled');
    const providerDefinition = this.providers.find((item) => item.id === providerId);
    if (!providerDefinition) throw new ProviderCatalogError('SELECTED_PROVIDER_UNAVAILABLE', `Provider '${provider}' is not registered`);
    const providerAvailability = availability(providerDefinition, this.env);
    if (providerAvailability === 'UNAVAILABLE') throw new ProviderCatalogError('SELECTED_PROVIDER_UNAVAILABLE', `Provider '${providerId}' is unavailable`);
    if (providerAvailability === 'NOT_CONFIGURED') throw new ProviderCatalogError('CREDENTIALS_MISSING', `${providerDefinition.displayName} credentials are not configured`);
    const modelDefinition = this.listModels(providerId).find((item) => item.modelId === model);
    if (!modelDefinition) throw new ProviderCatalogError('SELECTED_MODEL_UNAVAILABLE', `Model '${model}' is not registered for ${providerDefinition.displayName}`);
    if (modelDefinition.experimental && !(allowExperimental || this.env.V28_ALLOW_EXPERIMENTAL_MODELS === 'true')) {
      throw new ProviderCatalogError('SELECTED_MODEL_UNAVAILABLE', `Model '${model}' is experimental and explicit experimental use is disabled`);
    }
    const normalizedCapability = normalizeCapability(capability);
    if (!modelDefinition.capabilities.includes(normalizedCapability)) {
      throw new ProviderCatalogError('CAPABILITY_UNSUPPORTED', `${modelDefinition.displayName} does not support ${normalizedCapability}`);
    }
    const profileName = String(profile || '').toUpperCase();
    const settings = modelDefinition.profiles?.[profileName];
    if (!settings) throw new ProviderCatalogError('SELECTED_PROFILE_UNAVAILABLE', `Profile '${profile}' is unavailable for ${modelDefinition.displayName}`);
    const constraints = modelDefinition.constraints || {};
    const effectiveDuration = durationSeconds ?? (Number(String(settings.duration || '').replace(/s$/, '')) || null);
    const effectiveResolution = resolution || settings.resolution || null;
    if (effectiveDuration != null && constraints.durations && !constraints.durations.includes(effectiveDuration)) {
      throw new ProviderCatalogError('UNSUPPORTED_DURATION', `${modelDefinition.displayName} does not support ${effectiveDuration}s`);
    }
    if (effectiveResolution && constraints.resolutions && !constraints.resolutions.includes(effectiveResolution)) {
      throw new ProviderCatalogError('UNSUPPORTED_RESOLUTION', `${modelDefinition.displayName} does not support ${effectiveResolution}`);
    }
    if (aspectRatio && constraints.aspectRatios && !constraints.aspectRatios.includes(aspectRatio)) {
      throw new ProviderCatalogError('UNSUPPORTED_ASPECT_RATIO', `${modelDefinition.displayName} does not support ${aspectRatio}`);
    }
    return Object.freeze({ provider: providerId, providerDisplayName: providerDefinition.displayName,
      providerType: providerDefinition.type, vendor: modelDefinition.vendor, model: modelDefinition.modelId,
      modelVersion: modelDefinition.modelVersion || null, displayName: modelDefinition.displayName,
      adapterFamily: modelDefinition.adapterFamily, profile: profileName, capability: normalizedCapability,
      resolvedSettings: Object.freeze({ ...settings, ...(resolution ? { resolution } : {}),
        ...(durationSeconds ? { durationSeconds } : {}), ...(aspectRatio ? { aspectRatio } : {}) }),
      costStatus: modelDefinition.costStatus || 'UNKNOWN', relativeTier: modelDefinition.relativeTier || profileName,
      availability: providerAvailability, configured: true, experimental: modelDefinition.experimental === true });
  }
  async addModel(input) {
    if (!this.repository) throw new ProviderCatalogError('CATALOG_PERSISTENCE_UNAVAILABLE', 'Provider model persistence is unavailable');
    return this.repository.addModel({ ...input, workspaceId: input.workspaceId || this.workspaceId });
  }
  async snapshot() { await this.refresh(this.workspaceId); return this.listProviders(); }
}

module.exports = { AVAILABILITY, PRESETS, ProviderCatalog, ProviderCatalogError, PostgresProviderCatalogRepository };
