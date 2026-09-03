'use strict';

require('dotenv').config();
const path = require('node:path');
const { Pool } = require('pg');
const { FilesystemStorageAdapter } = require('../../../src/storage/storage-adapter');
const { ControlReviewService } = require('../../../src/v2.3/control-review-service');
const { ProductionCommandError, ProductionCommandService } = require('../../../src/v2.7/production-command-service');
const { QualityRecoveryService } = require('../../../src/v2.10.1/quality-recovery-service');
const { ControlRepository } = require('./control-repository');
const { ControlService } = require('./control-service');
const { createControlServer } = require('./http-server');
const { describeProviders } = require('./provider-status');
const { installSemanticRetryState } = require('./semantic-retry-state');
const { ProviderCatalog, PostgresProviderCatalogRepository } = require('../../../src/v2.8/provider-catalog');
const { QualityCreativeProductionService } = require('../../../src/v2.10/quality-creative-production-service');
const { HardenedQualityScriptFirstPostgresRepository } = require('../../../src/v2.10/quality-script-first-repository');
const { HardenedQualityScriptFirstService } = require('../../../src/v2.10/quality-script-first-service-hardened');
const { createVoicePreviewGateway } = require('../../../src/v2.10/runtime-integration');
const { V210IntegratedProductionStarter } = require('../../../src/v2.10/integrated-starter');
const { FfprobeMediaInspector } = require('../../../src/v2.5/media-validator');
const { createKeyframeImageGateway, createSemanticStillEvaluator } = require('../../../src/v2.10/locked-keyframe-service');
const { HardenedQualityLockedKeyframeService } = require('../../../src/v2.10/quality-locked-keyframe-service-hardened');

function wireQualityRecoveryShotRegeneration(commandService, qualityRecoveryService) {
  if (!commandService || !qualityRecoveryService) throw new Error('commandService and qualityRecoveryService are required');
  const preflight = commandService.preflightShotRegeneration.bind(commandService);
  const regenerate = commandService.regenerateShot.bind(commandService);
  const resolveRecoveryReason = async (args) => {
    if (args?.recoveryReason) return args;
    const plan = await qualityRecoveryService.inspect({ productionId: args.productionId, brandId: args.brandId });
    if (plan?.action === 'REGENERATE_SHOT' && plan.shotId === args.shotId
      && ['SOURCE_GEOMETRY','SOURCE_CONTINUITY','SOURCE_CREATIVE'].includes(plan.recoveryKind)) {
      return { ...args, recoveryReason: plan.recoveryKind };
    }
    return args;
  };
  commandService.preflightShotRegeneration = async (args) => preflight(await resolveRecoveryReason(args));
  commandService.regenerateShot = async (args) => regenerate(await resolveRecoveryReason(args));
  return commandService;
}

function usableSemanticModel(value) {
  const model = String(value || '').trim();
  return model && !/^your[_-]/i.test(model) && !/placeholder/i.test(model) ? model : null;
}

function lockedKeyframeSemanticEnvironment(env = process.env) {
  if (!env.OPENAI_API_KEY) return env;
  return {
    ...env,
    // Locked-keyframe execution already requires an explicit per-stage operator confirmation.
    // Force semantic evaluation on only inside this scoped runtime, even if the broad/global
    // semantic feature flag is false in .env.
    SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai',
    SEMANTIC_VISUAL_MODEL: usableSemanticModel(env.SEMANTIC_VISUAL_MODEL) || 'gpt-5.6-luna',
    LIVE_PAID_VISUAL_EVALUATION: 'true',
  };
}

function createDashboardRuntime(env = process.env, { previewProvider, creativeStarter,
  keyframeImageGateway, semanticStillEvaluator } = {}) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const storage = new FilesystemStorageAdapter({
    root: env.CONTENT_FACTORY_STORAGE_ROOT || path.resolve(process.cwd(), '.artifacts'),
  });
  const repository = installSemanticRetryState(new ControlRepository({ db }));
  const reviewService = new ControlReviewService({ db });
  const providers = describeProviders(env);
  const providerCatalog = new ProviderCatalog({ env, repository: new PostgresProviderCatalogRepository({ db }) });
  const actor = env.DASHBOARD_ACTOR || 'local-operator';
  const commandService = new ProductionCommandService({ repository, storage, providers, providerCatalog, env, actor });
  const semanticPreflight = commandService.preflightSemanticRetry.bind(commandService);
  commandService.preflightSemanticRetry = async (args) => {
    const active = await repository.activeSemanticRetryAttempt(args.productionId, args.brandId, null);
    if (active) throw new ProductionCommandError(409, 'SEMANTIC_RETRY_ALREADY_RUNNING',
      `Semantic recovery attempt ${active.attempt} is already running for this production`);
    return semanticPreflight(args);
  };
  const qualityRecoveryService = new QualityRecoveryService({ repository, storage, commandService, env, logger: console });
  wireQualityRecoveryShotRegeneration(commandService, qualityRecoveryService);
  const service = new ControlService({
    repository, reviewService, commandService, qualityRecoveryService, storage, providers, providerCatalog, actor, env,
  });
  const audioInspector = new FfprobeMediaInspector();
  const v210Repository = new HardenedQualityScriptFirstPostgresRepository({ db, storage });
  const resolvedPreviewProvider = previewProvider || createVoicePreviewGateway({ env });
  const resolvedStarter = creativeStarter || new V210IntegratedProductionStarter({
    db, storage, repository: v210Repository, env, logger: console, mediaInspector: audioInspector,
  });
  const creativeService = new QualityCreativeProductionService({ repository: v210Repository,
    brandRepository: repository, providerCatalog, actor, env, storage, audioInspector,
    previewProvider: resolvedPreviewProvider, starter: resolvedStarter });
  const qualityDirectorService = new HardenedQualityScriptFirstService({ repository: v210Repository,
    brandRepository: repository, actor });
  const lockedKeyframeService = new HardenedQualityLockedKeyframeService({ repository: v210Repository,
    brandRepository: repository, providerCatalog, starter: resolvedStarter, storage,
    imageInspector: audioInspector, actor, env,
    imageGateway: keyframeImageGateway || createKeyframeImageGateway({ env }),
    stillEvaluator: semanticStillEvaluator || createSemanticStillEvaluator({ env: lockedKeyframeSemanticEnvironment(env) }) });
  return { db, storage, providerCatalog, service, qualityRecoveryService, creativeService, qualityDirectorService,
    v210Repository, creativeStarter: resolvedStarter, previewProvider: resolvedPreviewProvider, lockedKeyframeService,
    server: createControlServer({ service, creativeService, lockedKeyframeService, qualityDirectorService }) };
}

if (require.main === module) {
  const host = process.env.DASHBOARD_API_HOST || '127.0.0.1';
  const port = Number(process.env.DASHBOARD_API_PORT || 3001);
  const runtime = createDashboardRuntime();
  runtime.server.listen(port, host, () => console.log(`Content Factory Control API: http://${host}:${port}`));
  const shutdown = () => runtime.server.close(() => runtime.db.end());
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createDashboardRuntime, lockedKeyframeSemanticEnvironment, usableSemanticModel,
  wireQualityRecoveryShotRegeneration };
