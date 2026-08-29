'use strict';

require('dotenv').config();
const path = require('node:path');
const { Pool } = require('pg');
const { FilesystemStorageAdapter } = require('../../../src/storage/storage-adapter');
const { ControlReviewService } = require('../../../src/v2.3/control-review-service');
const { ProductionCommandError, ProductionCommandService } = require('../../../src/v2.7/production-command-service');
const { ControlRepository } = require('./control-repository');
const { ControlService } = require('./control-service');
const { createControlServer } = require('./http-server');
const { describeProviders } = require('./provider-status');
const { installSemanticRetryState } = require('./semantic-retry-state');
const { ProviderCatalog, PostgresProviderCatalogRepository } = require('../../../src/v2.8/provider-catalog');
const { CreativeProductionService } = require('../../../src/v2.10/creative-production-service');
const { V210PostgresRepository } = require('../../../src/v2.10/postgres-repository');
const { FfprobeMediaInspector } = require('../../../src/v2.5/media-validator');

function createDashboardRuntime(env = process.env, { previewProvider = null, creativeStarter = null } = {}) {
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
  const service = new ControlService({
    repository, reviewService, commandService, storage, providers, providerCatalog, actor, env,
  });
  const creativeService = new CreativeProductionService({ repository: new V210PostgresRepository({ db, storage }),
    brandRepository: repository, actor, storage, audioInspector: new FfprobeMediaInspector(), previewProvider, starter: creativeStarter });
  return { db, server: createControlServer({ service, creativeService }) };
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

module.exports = { createDashboardRuntime };
