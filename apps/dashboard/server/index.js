'use strict';

require('dotenv').config();
const path = require('node:path');
const { Pool } = require('pg');
const { FilesystemStorageAdapter } = require('../../../src/storage/storage-adapter');
const { ControlReviewService } = require('../../../src/v2.3/control-review-service');
const { ProductionCommandService } = require('../../../src/v2.7/production-command-service');
const { ControlRepository } = require('./control-repository');
const { ControlService } = require('./control-service');
const { createControlServer } = require('./http-server');
const { describeProviders } = require('./provider-status');

function createDashboardRuntime(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const storage = new FilesystemStorageAdapter({
    root: env.CONTENT_FACTORY_STORAGE_ROOT || path.resolve(process.cwd(), '.artifacts'),
  });
  const repository = new ControlRepository({ db });
  const reviewService = new ControlReviewService({ db });
  const providers = describeProviders(env);
  const actor = env.DASHBOARD_ACTOR || 'local-operator';
  const commandService = new ProductionCommandService({ repository, storage, providers, env, actor });
  const service = new ControlService({
    repository, reviewService, commandService, storage, providers, actor,
  });
  return { db, server: createControlServer({ service }) };
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
