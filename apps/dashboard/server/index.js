'use strict';

require('dotenv').config();
const path = require('node:path');
const { Pool } = require('pg');
const { FilesystemStorageAdapter } = require('../../../src/storage/storage-adapter');
const { ArtifactService } = require('../../../src/artifacts/artifact-service');
const { ControlReviewService } = require('../../../src/v2.3/control-review-service');
const { ProductionCommandError, ProductionCommandService } = require('../../../src/v2.7/production-command-service');
const { QualityRecoveryService } = require('../../../src/v2.10.1/quality-recovery-service');
const { ControlRepository } = require('./control-repository');
const { ControlService } = require('./control-service');
const { createControlServer } = require('./http-server');
const { describeProviders } = require('./provider-status');
const { installSemanticRetryState } = require('./semantic-retry-state');
const { ProviderCatalog, PostgresProviderCatalogRepository } = require('../../../src/v2.8/provider-catalog');
const { CreativeProductionService } = require('../../../src/v2.10/creative-production-service');
const { V210PostgresRepository } = require('../../../src/v2.10/postgres-repository');
const { createVoicePreviewGateway } = require('../../../src/v2.10/runtime-integration');
const { V210IntegratedProductionStarter } = require('../../../src/v2.10/integrated-starter');
const { FfprobeMediaInspector } = require('../../../src/v2.5/media-validator');
const { AvatarStudioPostgresRepository } = require('../../../src/avatar-studio/postgres-repository');
const { AvatarStudioService } = require('../../../src/avatar-studio/service');
const { AvatarAssetIntakeService } = require('../../../src/avatar-studio/asset-intake-service');
const { SafeUrlImporter } = require('../../../src/avatar-studio/safe-url-import');
const { PassportExecutionService } = require('../../../src/avatar-studio/passport-execution-service');
const { createDefaultProviderGateway } = require('../../../src/providers/default-provider-gateway');

function wireQualityRecoveryShotRegeneration(commandService, qualityRecoveryService) {
  if (!commandService || !qualityRecoveryService) throw new Error('commandService and qualityRecoveryService are required');
  const preflight = commandService.preflightShotRegeneration.bind(commandService);
  const regenerate = commandService.regenerateShot.bind(commandService);
  const resolveRecoveryReason = async (args) => {
    if (args?.recoveryReason) return args;
    const plan = await qualityRecoveryService.inspect({ productionId: args.productionId, brandId: args.brandId });
    if (plan?.action === 'REGENERATE_SHOT' && plan.shotId === args.shotId
      && ['SOURCE_GEOMETRY','SOURCE_CONTINUITY'].includes(plan.recoveryKind)) {
      return { ...args, recoveryReason: plan.recoveryKind };
    }
    return args;
  };
  commandService.preflightShotRegeneration = async (args) => preflight(await resolveRecoveryReason(args));
  commandService.regenerateShot = async (args) => regenerate(await resolveRecoveryReason(args));
  return commandService;
}

function createDashboardRuntime(env = process.env, { previewProvider, creativeStarter } = {}) {
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
  const v210Repository = new V210PostgresRepository({ db, storage });
  const resolvedPreviewProvider = previewProvider || createVoicePreviewGateway({ env });
  const resolvedStarter = creativeStarter || new V210IntegratedProductionStarter({
    db, storage, repository: v210Repository, env, logger: console, mediaInspector: audioInspector,
  });
  const creativeService = new CreativeProductionService({ repository: v210Repository,
    brandRepository: repository, providerCatalog, actor, env, storage, audioInspector,
    previewProvider: resolvedPreviewProvider, starter: resolvedStarter });
  const avatarRepository = new AvatarStudioPostgresRepository({ db });
  const avatarAssetIntakeService = new AvatarAssetIntakeService({ repository: avatarRepository,
    artifactService: new ArtifactService({ storage }), storage, mediaInspector: audioInspector,
    safeUrlImporter: new SafeUrlImporter(), actor });
  const passportExecutionService = new PassportExecutionService({ repository: avatarRepository, providerCatalog,
    providerGateway: createDefaultProviderGateway({ openai: { apiKey: env.OPENAI_API_KEY },
      replicate: { enabled: false }, routing: { fallbackOnError: false } }),
    assetIntakeService: avatarAssetIntakeService, storage, env, actor });
  const avatarService = new AvatarStudioService({ repository: avatarRepository, assetIntakeService: avatarAssetIntakeService,
    providerCatalog, passportExecutionService, actor });
  return { db, storage, providerCatalog, service, qualityRecoveryService, creativeService, avatarService, avatarRepository, v210Repository,
    avatarAssetIntakeService, creativeStarter: resolvedStarter, previewProvider: resolvedPreviewProvider,
    server: createControlServer({ service, creativeService, avatarService }) };
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

module.exports = { createDashboardRuntime, wireQualityRecoveryShotRegeneration };
