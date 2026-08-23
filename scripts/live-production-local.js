'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function placeholder(url) {
  return !url || /(?:USER|PASSWORD|HOST)/.test(url);
}

function inspectEnv(container) {
  const raw = execFileSync('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container], { encoding: 'utf8' });
  return Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
  }));
}

function discover(env) {
  if (!placeholder(env.DATABASE_URL)) return env.DATABASE_URL;
  const container = env.CONTENT_FACTORY_POSTGRES_CONTAINER || 'n8n-postgres-1';
  const values = inspectEnv(container);
  const user = values.POSTGRES_USER || 'postgres';
  const password = values.POSTGRES_PASSWORD || '';
  const database = values.POSTGRES_DB || 'postgres';
  let port = 5432;
  try {
    const raw = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
    const match = raw.match(/:(\d+)$/m);
    if (match) port = Number(match[1]);
  } catch {}
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `postgresql://${auth}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

function run(script, env) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

try {
  const databaseUrl = discover(process.env);
  const storageRoot = process.env.CONTENT_FACTORY_STORAGE_ROOT || path.join(os.homedir(), '.content-factory', 'storage');
  const inputFile = process.env.LIVE_PRODUCTION_INPUT || '/tmp/live-production.json';
  if (!fs.existsSync(inputFile)) {
    const error = new Error(`Live production input not found: ${inputFile}`);
    error.code = 'LOCAL_LIVE_INPUT_MISSING';
    throw error;
  }

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    CONTENT_FACTORY_STORAGE_ROOT: storageRoot,
    LIVE_PRODUCTION_INPUT: inputFile,
    LIVE_PAID_GENERATION: process.env.LIVE_PAID_GENERATION || 'false',
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER || 'replicate',
  };

  console.log(`Local live mode: ${env.LIVE_PAID_GENERATION === 'true' ? 'PAID LIVE' : 'DRY RUN ($0)'}`);
  console.log(`Input: ${inputFile}`);
  console.log('Preparing local Content Factory database/storage...');
  run(path.resolve('scripts/prepare-local-live-production.js'), env);

  console.log('\nStarting controlled live-production command...');
  run(path.resolve('scripts/live-production.js'), env);
} catch (error) {
  console.error(`[${error.code || 'LOCAL_LIVE_RUNNER_ERROR'}] ${error.message}`);
  process.exitCode = 1;
}
