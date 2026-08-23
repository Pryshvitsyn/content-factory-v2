'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverLocalDatabase, localStorageRoot } = require('./local-runtime');

function run(script, env) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

try {
  const discovered = discoverLocalDatabase(process.env);
  const storageRoot = localStorageRoot(process.env);
  const inputFile = process.env.LIVE_PRODUCTION_INPUT || '/tmp/live-production.json';
  if (!fs.existsSync(inputFile)) {
    const error = new Error(`Live production input not found: ${inputFile}`);
    error.code = 'LOCAL_LIVE_INPUT_MISSING';
    throw error;
  }

  const env = {
    ...process.env,
    DATABASE_URL: discovered.url,
    CONTENT_FACTORY_STORAGE_ROOT: storageRoot,
    LIVE_PRODUCTION_INPUT: inputFile,
    LIVE_PAID_GENERATION: process.env.LIVE_PAID_GENERATION || 'false',
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER || 'replicate',
  };

  console.log(`Local live mode: ${env.LIVE_PAID_GENERATION === 'true' ? 'PAID LIVE' : 'DRY RUN ($0)'}`);
  console.log(`Database: ${discovered.database} (${discovered.source})`);
  console.log(`Input: ${inputFile}`);
  console.log('Preparing local Content Factory database/storage...');
  run(path.resolve('scripts/prepare-local-live-production.js'), env);

  console.log('\nStarting controlled live-production command...');
  run(path.resolve('scripts/live-production.js'), env);
} catch (error) {
  console.error(`[${error.code || 'LOCAL_LIVE_RUNNER_ERROR'}] ${error.message}`);
  process.exitCode = 1;
}
