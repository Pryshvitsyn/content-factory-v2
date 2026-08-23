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
  const inputFile = process.env.REAL_PRODUCTION_INPUT || 'config/productions/attune-dont-guess-tune-in.json';
  if (!fs.existsSync(inputFile)) throw Object.assign(new Error(`Real production input not found: ${inputFile}`), { code: 'LOCAL_REAL_INPUT_MISSING' });
  const env = {
    ...process.env,
    DATABASE_URL: discovered.url,
    CONTENT_FACTORY_STORAGE_ROOT: localStorageRoot(process.env),
    REAL_PRODUCTION_INPUT: path.resolve(inputFile),
    LIVE_PAID_GENERATION: process.env.LIVE_PAID_GENERATION || 'false',
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER || 'replicate',
    AUDIO_PROVIDER: process.env.AUDIO_PROVIDER || 'openai-media',
  };
  console.log(`V2.5 local mode: ${env.LIVE_PAID_GENERATION === 'true' ? 'PAID LIVE' : 'DRY RUN ($0)'}`);
  console.log(`Database: ${discovered.database} (${discovered.source})`);
  console.log(`Input: ${env.REAL_PRODUCTION_INPUT}`);
  run(path.resolve('scripts/prepare-local-live-production.js'), env);
  run(path.resolve('scripts/real-content-production.js'), env);
} catch (error) {
  console.error(`[${error.code || 'LOCAL_V25_RUNNER_ERROR'}] ${error.message}`);
  process.exitCode = 1;
}
