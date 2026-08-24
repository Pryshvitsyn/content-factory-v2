'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { assertPaidCredentials, resolveV25Configuration } = require('../src/v2.5/configuration');
const { buildProductionInput } = require('../src/v2.5/production-input');
const { createProductionRuntime, planOnlyAdapter, providerGateway } = require('../src/v2.7/production-runtime');

async function main() {
  if (!process.env.REAL_PRODUCTION_INPUT) throw Object.assign(new Error('REAL_PRODUCTION_INPUT is required'), { code: 'V25_CONFIGURATION_INVALID' });
  const raw = JSON.parse(await fs.readFile(path.resolve(process.env.REAL_PRODUCTION_INPUT), 'utf8'));
  const input = buildProductionInput(raw);
  const config = resolveV25Configuration(process.env, input);
  assertPaidCredentials({ config, input });
  const db = new Pool({ connectionString: config.databaseUrl, max: 4 });
  try {
    const storage = new FilesystemStorageAdapter({ root: config.storageRoot });
    const { service } = createProductionRuntime({ db, storage, config, env: process.env });
    const result = await service.run({ input, config });
    if (result.dryRun) {
      console.log(input.schemaVersion >= 3
        ? 'V2.6 DRY RUN PASSED — provider/renderer jobs = 0.'
        : 'V2.5 DRY RUN PASSED — provider calls = 0.');
      console.log(JSON.stringify(result.plan, null, 2));
      return;
    }
    console.log(`${input.schemaVersion >= 3 ? 'V2.6' : 'V2.5'} REAL CONTENT PRODUCTION COMPLETED`);
    console.log(JSON.stringify(result, null, 2));
    console.log('Publication was not triggered. Open the Review Queue with npm run dashboard:local.');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${error.code || 'V25_PRODUCTION_ERROR'}] ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { main, planOnlyAdapter, providerGateway };
