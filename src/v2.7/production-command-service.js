'use strict';

const { assertPaidCredentials, resolveV25Configuration } = require('../v2.5/configuration');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');
const { createProductionRuntime } = require('./production-runtime');
const { buildOperatorProductionInput } = require('./operator-production-input');
const { resolveQualityVideoProfile, qualityProfileFromSelection } = require('./quality-video-profile');
const { buildShotRevision } = require('./shot-regeneration');
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
    credentialCheck = assertPaidCredentials, scheduler = defaultSchedule, providers = [],
    qualityProfileResolver = resolveQualityVideoProfile, providerCatalog = null } = {}) {
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
    this.qualityProfileResolver = qualityProfileResolver;
    this.providerCatalog = providerCatalog;
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
    if (this.providerCatalog) {
      if (input.voiceover?.enabled && !this.env.OPENAI_API_KEY) {
        throw new ProductionCommandError(409, 'CREDENTIALS_MISSING', 'OpenAI speech credentials are not configured');
      }
      return;
    }
    if (!configured('VIDEO', 'replicate')) {
      throw new ProductionCommandError(409, 'QUALITY_RENDERER_UNAVAILABLE', 'QUALITY is unavailable: Replicate video is not configured');
    }
    const video = this.providers.find((item) => item.capability === 'VIDEO'
      && String(item.provider).toLowerCase() === input.qualityVideoProfile?.provider);
    if (video?.model && video.model !== input.qualityVideoProfile?.model) {
      throw new ProductionCommandError(409, 'QUALITY_MODEL_UNAVAILABLE', 'Requested QUALITY model is not the configured adapter model; no downgrade was applied');
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
      VIDEO_PROVIDER: input.qualityVideoProfile?.provider || 'replicate',
      AUDIO_PROVIDER: 'openai-media',
      ...(input.qualityVideoProfile ? { REPLICATE_VIDEO_MODEL: input.qualityVideoProfile.model,
        QUALITY_VIDEO_MODEL: input.qualityVideoProfile.model,
        QUALITY_VIDEO_PROVIDER: input.qualityVideoProfile.provider } : {}),
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
    let scopedCatalog = this.providerCatalog;
    try {
      let qualityProfile = null;
      if (String(request.renderMode || '').toUpperCase() === 'QUALITY') {
        if (this.providerCatalog) {
          scopedCatalog = await this.providerCatalog.forWorkspace(brand.workspaceId);
          const selection = scopedCatalog.resolveSelection({
            provider: request.provider || this.env.DEFAULT_QUALITY_PROVIDER,
            model: request.model || this.env.DEFAULT_QUALITY_MODEL,
            profile: request.profile || this.env.DEFAULT_QUALITY_PROFILE || 'STANDARD',
            capability: request.capability || 'TEXT_TO_VIDEO', aspectRatio: request.aspectRatio || '9:16',
            allowExperimental: request.allowExperimental === true,
          });
          qualityProfile = qualityProfileFromSelection(selection);
        } else qualityProfile = this.qualityProfileResolver(this.env);
      }
      built = buildOperatorProductionInput(request, brand, { productionKey, qualityProfile });
    }
    catch (error) {
      if (['V27_INPUT_INVALID','V25_INPUT_INVALID','QUALITY_PROFILE_INVALID','QUALITY_MODEL_REQUIRED','QUALITY_CAPABILITY_UNAVAILABLE',
        'SELECTED_PROVIDER_UNAVAILABLE','SELECTED_MODEL_UNAVAILABLE','SELECTED_PROFILE_UNAVAILABLE','CAPABILITY_UNSUPPORTED',
        'CREDENTIALS_MISSING','UNSUPPORTED_DURATION','UNSUPPORTED_RESOLUTION','UNSUPPORTED_ASPECT_RATIO'].includes(error.code)) {
        throw new ProductionCommandError(400, error.code, error.message, error.details);
      }
      throw error;
    }
    if (scopedCatalog && built.input.renderMode === 'QUALITY') {
      try {
        for (const asset of built.input.assetPlan.assets.filter((item) => item.kind === 'video')) {
          const requirements = asset.generation_requirements;
          scopedCatalog.validateSelection({ provider: requirements.provider, model: requirements.model,
            profile: requirements.profile, capability: requirements.capability,
            durationSeconds: requirements.target_clip_duration_ms / 1000,
            resolution: requirements.resolution, aspectRatio: requirements.aspect_ratio,
            allowExperimental: request.allowExperimental === true });
        }
      } catch (error) {
        if (error.code) throw new ProductionCommandError(error.status || 409, error.code, error.message, error.details);
        throw error;
      }
    }
    this.assertCapability(built.input);
    const runtime = this.runtime(built.input, { forceDryRun: true });
    let prepared;
    try { prepared = await runtime.service.prepare({ input: built.input, config: runtime.config }); }
    catch (error) {
      if (error.code === 'LIVE_PREFLIGHT_VALIDATION_FAILED') {
        throw new ProductionCommandError(409, error.code, error.message, error.details);
      }
      throw error;
    }
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
      qualityProfile: command.input.qualityVideoProfile,
      profile: command.input.qualityVideoProfile?.name || null,
      vendor: command.input.qualityVideoProfile?.vendor || null,
      capability: command.input.qualityVideoProfile?.capability || (command.input.renderMode === 'FAST' ? 'FAST_RENDER' : null),
      resolvedGenerationSettings: command.input.qualityVideoProfile?.resolvedSettings || null,
      configurationStatus: plan.readiness === 'BLOCKED'
        ? 'QUALITY_EVALUATOR_REQUIRED'
        : command.input.renderMode === 'QUALITY' ? 'CONFIGURED' : plan.rendererAvailability?.availability || 'READY',
      resolution: command.input.qualityVideoProfile?.resolution || null,
      qualityMode: command.input.qualityVideoProfile?.goFast === false ? 'QUALITY' : 'FAST',
      promptOptimization: command.input.qualityVideoProfile?.optimizePrompt ?? null,
      targetPlatform: command.input.targetPlatform,
      targetDurationSeconds: plan.targetDurationSeconds,
      aspectRatio: plan.aspectRatio,
      expectedVideoGenerations: plan.expectedVideoGenerations || 0,
      expectedAudioGenerations: plan.expectedAudioGenerations || 0,
      expectedProviderCalls: plan.expectedPaidProviderCalls || 0,
      expectedRendererJobs: plan.expectedRendererJobs || 0,
      expectedExternalExecutions: plan.expectedExternalServiceCalls
        ?? ((plan.expectedPaidProviderCalls || 0) + (plan.expectedRendererJobs || 0) + (plan.expectedQualityEvaluatorCalls || 0)),
      expectedQualityEvaluatorCalls: plan.expectedQualityEvaluatorCalls || 0,
      expectedSemanticEvaluations: plan.expectedSemanticEvaluations || 0,
      expectedSourceSemanticEvaluations: plan.expectedSourceSemanticEvaluations || 0,
      expectedFinalSemanticEvaluations: plan.expectedFinalSemanticEvaluations || 0,
      expectedContinuityEvaluations: plan.expectedContinuityEvaluations || 0,
      expectedSemanticEvaluationCalls: plan.expectedSemanticEvaluationCalls || 0,
      expectedContinuityEvaluationCalls: plan.expectedContinuityEvaluationCalls || 0,
      semanticEvaluatorProvider: plan.semanticEvaluatorProvider || null,
      semanticEvaluatorModel: plan.semanticEvaluatorModel || null,
      semanticEvaluatorStatus: plan.semanticEvaluatorStatus || 'NOT_CONFIGURED',
      semanticEvaluatorConfigurationErrors: plan.semanticEvaluatorConfigurationErrors || [],
      semanticEvaluatorMaxRetries: plan.semanticEvaluatorMaxRetries || 0,
      expectedMaxEvaluatorHttpAttempts: plan.expectedMaxEvaluatorHttpAttempts || 0,
      expectedExternalServiceCallCeiling: plan.expectedExternalServiceCallCeiling
        ?? ((plan.expectedPaidProviderCalls || 0) + (plan.expectedMaxEvaluatorHttpAttempts || 0)),
      semanticFinalEvaluationPolicy: plan.semanticFinalEvaluationPolicy || null,
      qualityEvaluatorPolicy: plan.qualityEvaluatorPolicy || (command.input.renderMode === 'QUALITY' ? 'NOT_CONFIGURED' : 'NOT_APPLICABLE'),
      expectedExternalExecutionClasses: plan.expectedExternalExecutionClasses || [],
      estimatedCost: plan.estimatedCost ?? null,
      costStatus: plan.costStatus || (plan.estimatedCost == null ? 'UNKNOWN' : 'KNOWN'),
      costNote: plan.costNote,
      rendererStatus: plan.rendererAvailability?.availability || plan.rendererAvailability?.status || 'READY',
      schemaStatus: plan.schemaCompatibility,
      readiness: plan.readiness || 'READY',
      preExecutionValidation: plan.preExecutionValidation || null,
      finalMasterDeliveryProfile: plan.finalMasterDeliveryProfile || null,
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
    if (command.prepared.plan.readiness === 'BLOCKED') {
      throw new ProductionCommandError(409, 'SEMANTIC_VISUAL_QA_NOT_CONFIGURED',
        'STANDARD and PREMIUM production require a configured semantic visual evaluator before any paid generation');
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
    const prepared = await runtime.service.prepare({ input, config: runtime.config });
    if (prepared.plan.readiness === 'BLOCKED') {
      throw new ProductionCommandError(409, 'SEMANTIC_VISUAL_QA_NOT_CONFIGURED',
        'Start is blocked before provider execution because semantic visual evaluation is not configured and authorized');
    }
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

  async prepareShotRegeneration({ productionId, brandId, shotId, requestId, instruction = null }) {
    const source = await this.stored(productionId, brandId);
    if (source.renderMode !== 'QUALITY') throw new ProductionCommandError(409, 'SHOT_REGENERATION_UNAVAILABLE', 'Per-shot regeneration is available for QUALITY productions only');
    if (['RUNNING','QUEUED'].includes(source.jobStatus)) throw new ProductionCommandError(409, 'SHOT_REGENERATION_UNAVAILABLE', `Shot regeneration is unavailable while the durable job is ${source.jobStatus}`);
    const safety = await this.repository.executionSafety(source.id);
    if (safety.ambiguousExecutions > 0) throw new ProductionCommandError(409, 'EXECUTION_NEEDS_RECONCILIATION', 'Shot regeneration requires reconciliation before another provider execution');
    if (instruction !== null && (typeof instruction !== 'string' || instruction.trim().length > 2400)) {
      throw new ProductionCommandError(400, 'V27_INPUT_INVALID', 'Shot regeneration instruction must be a string up to 2400 characters');
    }
    const latest = await this.repository.latestShotRevision(productionId, brandId);
    const raw = latest?.canonicalRawInput || source.jobPayload.canonicalRawInput;
    const revisionNo = await this.repository.nextShotRevision(productionId, shotId);
    let revision;
    try { revision = buildShotRevision(raw, { shotId, requestId, instruction: instruction?.trim() || null, revisionNo }); }
    catch (error) {
      if (error.code === 'SHOT_NOT_FOUND') throw new ProductionCommandError(404, error.code, error.message);
      throw error;
    }
    this.assertCapability(revision.input);
    const runtime = this.runtime(revision.input, { forceDryRun: true });
    if (typeof runtime.service.prepareRevision !== 'function') throw new ProductionCommandError(500, 'SHOT_REVISION_RUNTIME_UNAVAILABLE', 'Runtime does not support immutable shot revisions');
    const prepared = await runtime.service.prepareRevision({ input: revision.input, config: runtime.config, productionId });
    const expectedVideos = prepared.plan.expectedVideoGenerations || 0;
    const expectedAudio = prepared.plan.expectedAudioGenerations || 0;
    if (expectedVideos !== 1 || expectedAudio !== 0 || prepared.plan.expectedPaidProviderCalls !== 1) {
      throw new ProductionCommandError(409, 'SHOT_REGENERATION_PLAN_INVALID', 'Per-shot preflight must reuse existing media and generate exactly one video asset');
    }
    return { source, revision, prepared };
  }

  async preflightShotRegeneration(args) {
    const command = await this.prepareShotRegeneration(args);
    return Object.freeze({ preflightId: command.revision.input.fingerprint, productionId: args.productionId,
      shotId: args.shotId, sourceAssetId: command.revision.sourceAssetId,
      replacementAssetId: command.revision.replacementAssetId, revisionNo: command.revision.revisionNo,
      expectedVideoGenerations: 1, expectedAudioGenerations: 0, expectedProviderCalls: 1,
      expectedSemanticEvaluations: command.prepared.plan.expectedSemanticEvaluations || 0,
      expectedContinuityEvaluations: command.prepared.plan.expectedContinuityEvaluations || 0,
      expectedEvaluatorCalls: command.prepared.plan.expectedQualityEvaluatorCalls || 0,
      expectedExternalCalls: 1 + (command.prepared.plan.expectedQualityEvaluatorCalls || 0),
      semanticEvaluatorProvider: command.prepared.plan.semanticEvaluatorProvider || null,
      semanticEvaluatorModel: command.prepared.plan.semanticEvaluatorModel || null,
      provider: command.prepared.plan.provider, model: command.prepared.plan.model,
      resolution: command.prepared.plan.resolution, estimatedCost: null, costStatus: 'UNKNOWN',
      humanApprovalRequired: true, autoPublish: false, providerCalls: 0 });
  }

  async regenerateShot(args) {
    if (args.confirmation !== true) throw new ProductionCommandError(400, 'SHOT_REGENERATION_CONFIRMATION_REQUIRED', 'Explicit per-shot cost confirmation is required');
    const prior = typeof this.repository.getShotRegenerationByRequest === 'function'
      ? await this.repository.getShotRegenerationByRequest(args.productionId, args.requestId) : null;
    if (prior) {
      if (prior.inputFingerprint !== args.preflightId && prior.input_fingerprint !== args.preflightId) {
        throw new ProductionCommandError(409, 'SHOT_REGENERATION_CONFLICT', 'requestId belongs to a different per-shot input');
      }
      if (['SUCCEEDED','RUNNING'].includes(prior.status)) return Object.freeze({
        regenerationId: prior.id, status: prior.status, reused: true,
        publicationTriggered: false, humanApprovalRequired: true });
      const raw = prior.canonicalRawInput || prior.canonical_raw_input;
      if (!raw) throw new ProductionCommandError(500, 'SHOT_REGENERATION_STATE_INVALID', 'Persisted shot regeneration is missing canonical input');
      return this.scheduleShotExecution({ record: prior, input: operatorInputFromRaw(raw), args, reused: true });
    }
    const command = await this.prepareShotRegeneration(args);
    if (!args.preflightId || args.preflightId !== command.revision.input.fingerprint) {
      throw new ProductionCommandError(409, 'PREFLIGHT_STALE', 'Run per-shot preflight for the exact current instruction before regeneration');
    }
    let record;
    try { record = await this.repository.ensureShotRegeneration({ workspaceId: command.prepared.brand.workspaceId,
      brandId: args.brandId, productionId: args.productionId, requestId: args.requestId, shotId: args.shotId,
      sourceAssetId: command.revision.sourceAssetId, replacementAssetId: command.revision.replacementAssetId,
      revisionNo: command.revision.revisionNo, inputFingerprint: command.revision.input.fingerprint,
      canonicalRawInput: command.revision.raw, instruction: args.instruction?.trim() || null,
      provider: command.prepared.plan.provider, model: command.prepared.plan.model,
      resolution: command.prepared.plan.resolution }); }
    catch (error) {
      if (error.code === 'SHOT_REGENERATION_ACTIVE') throw new ProductionCommandError(409, error.code, error.message);
      throw error;
    }
    if (record.status === 'SUCCEEDED' || record.status === 'RUNNING') return Object.freeze({
      regenerationId: record.id, status: record.status, reused: true, publicationTriggered: false });
    return this.scheduleShotExecution({ record, input: command.revision.input, args, reused: false,
      revision: command.revision });
  }

  scheduleShotExecution({ record, input, args, reused, revision = null }) {
    const runtime = this.runtime(input);
    this.scheduler(async () => {
      const claimed = await this.repository.claimShotRegeneration(record.id, runtime.config.workerId);
      if (!claimed) return;
      try {
        const prepared = await runtime.service.prepareRevision({ input,
          config: runtime.config, productionId: args.productionId });
        const master = await runtime.rendererRouter.render({ productionId: args.productionId,
          workspaceId: prepared.input.workspaceId, brandId: args.brandId, workerId: runtime.config.workerId,
          input: prepared.input, script: prepared.input.script, shotPlan: prepared.input.shotPlan,
          assetPlan: prepared.input.assetPlan,
          qualityPolicy: { requireVoiceForSpokenCopy: prepared.input.voiceover?.enabled === true,
            strictApprovedCopy: prepared.input.spokenCopyPolicy?.strictApprovedCopy !== false,
            requireVoiceTimingPlan: prepared.input.schemaVersion >= 2,
            requireProviderCompatibility: prepared.input.schemaVersion >= 2,
            creativePlan: prepared.input.creativePlan || null,
            masterVisualTransforms: prepared.input.captions?.enabled === true } });
        await this.repository.completeShotRegeneration(record.id, { replacementAssetId: revision?.replacementAssetId
          || record.replacementAssetId || record.replacement_asset_id,
          masterArtifact: master.master?.artifact || null, quality: master.quality || null,
          publicationTriggered: false, humanApprovalRequired: true });
      } catch (error) {
        await this.repository.failShotRegeneration(record.id, error);
        throw error;
      }
    }, this.logger);
    return Object.freeze({ regenerationId: record.id, productionId: args.productionId, shotId: args.shotId,
      replacementAssetId: revision?.replacementAssetId || record.replacementAssetId || record.replacement_asset_id,
      revisionNo: revision?.revisionNo || record.revisionNo || record.revision_no,
      status: record.status, accepted: true, reused, expectedProviderCalls: 1, publicationTriggered: false,
      humanApprovalRequired: true });
  }
}

module.exports = { ProductionCommandError, ProductionCommandService, operatorInputFromRaw };
