'use strict';

const { assertPaidCredentials, resolveV25Configuration } = require('../v2.5/configuration');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');
const { createProductionRuntime } = require('./production-runtime');
const { buildOperatorProductionInput } = require('./operator-production-input');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProductionCommandError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ProductionCommandError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function operatorInputFromRaw(raw) {
  const base = buildProductionInput(raw);
  const normalized = { ...base, productionNamespace: 'v2.7-operator' };
  delete normalized.fingerprint;
  return Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
}

function defaultSchedule(task, logger) {
  setImmediate(() => Promise.resolve().then(task).catch((error) => logger.error?.('V2.7 background production failed', {
    code: error.code || 'V27_EXECUTION_FAILED', message: error.message,
  })));
}

class ProductionCommandService {
  constructor({ repository, storage, env = process.env, actor = 'local-operator', logger = console,
    runtimeFactory = createProductionRuntime, configResolver = resolveV25Configuration,
    credentialCheck = assertPaidCredentials, scheduler = defaultSchedule, providers = [] } = {}) {
    if (!repository || !storage) throw new Error('repository and storage are required');
    this.repository = repository;
    this.storage = storage;
    this.env = env;
    this.actor = actor;
    this.logger = logger;
    this.runtimeFactory = runtimeFactory;
    this.configResolver = configResolver;
    this.credentialCheck = credentialCheck;
    this.scheduler = scheduler;
    this.providers = providers;
  }

  assertCapability(input) {
    const configured = (capability, provider = null) => this.providers.some((item) => item.capability === capability
      && item.configured === true && (!provider || String(item.provider).toLowerCase() === provider));
    if (input.renderMode === 'FAST') {
      if (!configured('FAST RENDERER', 'moneyprinterturbo')) {
        throw new ProductionCommandError(409, 'FAST_RENDERER_UNAVAILABLE', 'FAST is unavailable: MoneyPrinterTurbo is not configured');
      }
      return;
    }
    if (!configured('VIDEO', 'replicate')) {
      throw new ProductionCommandError(409, 'QUALITY_RENDERER_UNAVAILABLE', 'QUALITY is unavailable: Replicate video is not configured');
    }
    if (input.voiceover?.enabled && !this.providers.some((item) => item.capability === 'SPEECH' && item.configured === true)) {
      throw new ProductionCommandError(409, 'QUALITY_AUDIO_UNAVAILABLE', 'QUALITY is unavailable: speech generation is not configured');
    }
  }

  runtime(input, { forceDryRun = false } = {}) {
    const env = {
      ...this.env,
      REAL_PRODUCTION_INPUT: this.env.REAL_PRODUCTION_INPUT || 'dashboard://operator-console',
      RENDER_MODE: input.renderMode,
      VIDEO_PROVIDER: 'replicate',
      AUDIO_PROVIDER: 'openai-media',
      FAST_RENDERER: input.renderMode === 'FAST' ? input.fastRender.renderer : this.env.FAST_RENDERER,
      ...(forceDryRun ? { LIVE_PAID_GENERATION: 'false' } : {}),
    };
    const config = this.configResolver(env, input);
    if (!forceDryRun) {
      if (!config.live) throw new ProductionCommandError(409, 'V27_EXECUTION_DISABLED',
        'Production execution is disabled. Start the local Dashboard with LIVE_PAID_GENERATION=true after reviewing provider cost.');
      this.credentialCheck({ config, input, env });
    }
    const runtime = this.runtimeFactory({ db: this.repository.db, storage: this.storage, config, env, logger: this.logger });
    return { ...runtime, config };
  }

  async prepareCommand(request, { productionKey = null } = {}) {
    if (!UUID_PATTERN.test(request?.brandId || '')) {
      throw new ProductionCommandError(400, 'V27_INPUT_INVALID', 'brandId must be a UUID');
    }
    const brand = await this.repository.getBrand(request?.brandId);
    if (!brand || brand.status !== 'ACTIVE') {
      throw new ProductionCommandError(404, 'BRAND_NOT_FOUND', 'Active brand not found in canonical workspace scope');
    }
    let built;
    try { built = buildOperatorProductionInput(request, brand, { productionKey }); }
    catch (error) {
      if (error.code === 'V27_INPUT_INVALID' || error.code === 'V25_INPUT_INVALID') {
        throw new ProductionCommandError(400, error.code, error.message, error.details);
      }
      throw error;
    }
    this.assertCapability(built.input);
    const runtime = this.runtime(built.input, { forceDryRun: true });
    const prepared = await runtime.service.prepare({ input: built.input, config: runtime.config });
    const rendererUnavailable = prepared.plan.rendererAvailability?.availability === 'UNAVAILABLE'
      || prepared.plan.rendererAvailability?.status === 'UNAVAILABLE';
    if (rendererUnavailable) throw new ProductionCommandError(409, 'RENDERER_UNAVAILABLE', 'Selected renderer health check is unavailable');
    if (prepared.plan.dryRunProviderCalls !== 0 || (prepared.plan.providerExecutions || 0) !== 0
      || (prepared.plan.dryRunRendererExecutions || 0) !== 0) {
      throw new ProductionCommandError(500, 'PREFLIGHT_PROVIDER_BOUNDARY_VIOLATION', 'Preflight attempted an external production execution');
    }
    return { ...built, input: prepared.input, runtime, prepared };
  }

  publicPreflight(command) {
    const { plan } = command.prepared;
    return Object.freeze({
      preflightId: command.input.fingerprint,
      canonicalRequest: command.canonicalRequest,
      brand: plan.brand,
      production: command.canonicalRequest.title,
      productionKey: command.input.productionKey,
      renderMode: plan.renderMode,
      renderer: plan.renderer,
      provider: plan.provider,
      model: plan.model,
      targetPlatform: command.input.targetPlatform,
      targetDurationSeconds: plan.targetDurationSeconds,
      aspectRatio: plan.aspectRatio,
      expectedVideoGenerations: plan.expectedVideoGenerations || 0,
      expectedAudioGenerations: plan.expectedAudioGenerations || 0,
      expectedProviderCalls: plan.expectedPaidProviderCalls || 0,
      expectedRendererJobs: plan.expectedRendererJobs || 0,
      expectedExternalExecutions: plan.expectedExternalServiceCalls
        ?? ((plan.expectedPaidProviderCalls || 0) + (plan.expectedRendererJobs || 0)),
      estimatedCost: plan.estimatedCost ?? null,
      costStatus: plan.costStatus || (plan.estimatedCost == null ? 'UNKNOWN' : 'KNOWN'),
      costNote: plan.costNote,
      rendererStatus: plan.rendererAvailability?.availability || plan.rendererAvailability?.status || 'READY',
      schemaStatus: plan.schemaCompatibility,
      humanApprovalRequired: plan.publicationPolicy?.requiresHumanApproval === true,
      autoPublish: false,
      preflightProviderExecutions: 0,
    });
  }

  async preflight(request) { return this.publicPreflight(await this.prepareCommand(request)); }

  async create(request, { preflightId } = {}) {
    const command = await this.prepareCommand(request);
    if (!preflightId || preflightId !== command.input.fingerprint) {
      throw new ProductionCommandError(409, 'PREFLIGHT_STALE', 'Run preflight for the exact current production request before creating it');
    }
    const rows = await command.runtime.service.createDraft({ input: command.input, config: command.runtime.config,
      command: { source: 'v2.7-operator-console', requestId: request.requestId, actor: this.actor,
        canonicalRawInput: command.canonicalRawInput, canonicalRequest: command.canonicalRequest } });
    return Object.freeze({ productionId: rows.production.id, jobId: rows.job.id, brandId: command.input.brandId,
      productionKey: command.input.productionKey, status: rows.production.status,
      jobStatus: rows.job.status, renderMode: command.input.renderMode, renderer: command.input.renderer,
      reused: rows.reused === true, publicationTriggered: false });
  }

  async stored(productionId, brandId) {
    const production = await this.repository.getCommandProduction(productionId, brandId);
    if (!production) throw new ProductionCommandError(404, 'PRODUCTION_NOT_FOUND', 'Production not found in canonical brand scope');
    if (production.metadata?.source !== 'v2.7-operator-console' || !production.jobPayload?.canonicalRawInput) {
      throw new ProductionCommandError(409, 'V27_COMMAND_UNAVAILABLE', 'This production was not created by the V2.7 operator command boundary');
    }
    return production;
  }

  async executable(production, { retry = false } = {}) {
    if (production.jobStatus === 'COMPLETED') return { terminal: true, production };
    const allowed = retry ? ['RETRYING'] : ['QUEUED'];
    if (!allowed.includes(production.jobStatus)) {
      throw new ProductionCommandError(409, retry ? 'RETRY_UNAVAILABLE' : 'START_UNAVAILABLE',
        `${retry ? 'Retry' : 'Start'} is unavailable while the durable job is ${production.jobStatus || 'missing'}`);
    }
    const safety = await this.repository.executionSafety(production.id);
    if (safety.ambiguousExecutions > 0) {
      throw new ProductionCommandError(409, 'EXECUTION_NEEDS_RECONCILIATION',
        'External execution state is ambiguous; use recovery/reconciliation tooling before retrying or regenerating');
    }
    return { terminal: false, production };
  }

  async schedule(production, input) {
    this.assertCapability(input);
    const runtime = this.runtime(input);
    await runtime.service.prepare({ input, config: runtime.config });
    this.scheduler(() => runtime.service.run({ input, config: runtime.config }), this.logger);
    return Object.freeze({ productionId: production.id, jobId: production.jobId, brandId: production.brandId,
      status: production.status, jobStatus: production.jobStatus, accepted: true,
      renderMode: input.renderMode, renderer: input.renderer, publicationTriggered: false });
  }

  async start({ productionId, brandId, confirmation }) {
    if (confirmation !== true) throw new ProductionCommandError(400, 'START_CONFIRMATION_REQUIRED', 'Explicit Start Production confirmation is required');
    const production = await this.stored(productionId, brandId);
    const executable = await this.executable(production);
    if (executable.terminal) return Object.freeze({ productionId, jobId: production.jobId,
      status: production.status, jobStatus: production.jobStatus, accepted: false, reused: true, publicationTriggered: false });
    return this.schedule(production, operatorInputFromRaw(production.jobPayload.canonicalRawInput));
  }

  async retry({ productionId, brandId }) {
    const production = await this.stored(productionId, brandId);
    const executable = await this.executable(production, { retry: true });
    if (executable.terminal) return Object.freeze({ productionId, jobId: production.jobId,
      status: production.status, jobStatus: production.jobStatus, accepted: false, reused: true, publicationTriggered: false });
    return this.schedule(production, operatorInputFromRaw(production.jobPayload.canonicalRawInput));
  }

  async regenerate({ productionId, brandId, requestId, reason = null }) {
    if (reason !== null && reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 2400)) {
      throw new ProductionCommandError(400, 'V27_INPUT_INVALID', 'Regeneration instruction must be a string up to 2400 characters');
    }
    const regenerationInstruction = typeof reason === 'string' ? reason.trim() || null : null;
    const source = await this.stored(productionId, brandId);
    if (['RUNNING','QUEUED'].includes(source.jobStatus)) {
      throw new ProductionCommandError(409, 'REGENERATE_UNAVAILABLE', `Regeneration is unavailable while the durable job is ${source.jobStatus}`);
    }
    const safety = await this.repository.executionSafety(source.id);
    if (safety.ambiguousExecutions > 0) {
      throw new ProductionCommandError(409, 'EXECUTION_NEEDS_RECONCILIATION',
        'Regeneration unavailable: previous provider execution requires reconciliation');
    }
    const original = source.jobPayload.canonicalRequest;
    const request = { ...original, requestId, brandId, additionalInstructions: [original.additionalInstructions, regenerationInstruction]
      .filter(Boolean).join('\n') || undefined };
    const key = `regen-${String(source.id).slice(0, 8)}-${requestId}`;
    const command = await this.prepareCommand(request, { productionKey: key });
    const rows = await command.runtime.service.createDraft({ input: command.input, config: command.runtime.config,
      command: { source: 'v2.7-operator-console', requestId, actor: this.actor,
        canonicalRawInput: command.canonicalRawInput, canonicalRequest: command.canonicalRequest,
        regenerationOf: source.id } });
    return Object.freeze({ productionId: rows.production.id, jobId: rows.job.id, brandId,
      productionKey: command.input.productionKey, status: rows.production.status, jobStatus: rows.job.status,
      regenerationOf: source.id, reused: rows.reused === true, requiresExplicitStart: true,
      publicationTriggered: false });
  }
}

module.exports = { ProductionCommandError, ProductionCommandService, operatorInputFromRaw };
