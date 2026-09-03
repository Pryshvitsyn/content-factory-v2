'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { constants } = require('node:fs');
const { Pool } = require('pg');
const { discoverLocalDatabase, localStorageRoot } = require('./local-runtime');
const { prepareDatabase } = require('./prepare-local-live-production');
const { syncCanonicalBrands } = require('../src/brand-registry/sync-canonical-brands');

function dashboardPorts(env = process.env) {
  const apiPort = Number(env.DASHBOARD_API_PORT || 3001);
  const webPort = Number(env.DASHBOARD_WEB_PORT || 3000);
  for (const [name, value] of [['DASHBOARD_API_PORT', apiPort], ['DASHBOARD_WEB_PORT', webPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      const error = new Error(`${name} must be an integer between 1 and 65535`);
      error.code = 'LOCAL_DASHBOARD_PORT_INVALID';
      throw error;
    }
  }
  if (apiPort === webPort) {
    const error = new Error('DASHBOARD_API_PORT and DASHBOARD_WEB_PORT must be different');
    error.code = 'LOCAL_DASHBOARD_PORT_CONFLICT';
    throw error;
  }
  return { apiPort, webPort };
}

async function assertPortAvailable(host, port, label) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', (cause) => {
      const error = new Error(`${label} port ${host}:${port} is unavailable (${cause.code || cause.message}). Stop the existing process or choose another port.`);
      error.code = 'LOCAL_DASHBOARD_PORT_UNAVAILABLE';
      error.cause = cause;
      reject(error);
    });
    server.listen(port, host, resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function validateDashboardDatabase(db) {
  const result = await db.query(`/* dashboard:local-readiness */
    SELECT current_database() AS database,
      to_regclass('v2_1.productions') IS NOT NULL AS productions,
      to_regclass('v2_2.brands') IS NOT NULL AS brands,
      to_regclass('v2_3.master_review_items') IS NOT NULL AS reviews`);
  const state = result.rows[0];
  if (!state || !state.productions || !state.brands || !state.reviews) {
    const missing = ['productions','brands','reviews'].filter((name) => !state?.[name]);
    const error = new Error(`Database '${state?.database || 'unknown'}' is not the prepared Content Factory database (missing: ${missing.join(', ')}). Set CONTENT_FACTORY_DATABASE=content_os or a correct DATABASE_URL, then run the $0 local preparation command.`);
    error.code = 'LOCAL_DASHBOARD_SCHEMA_MISSING';
    throw error;
  }
  return state;
}

function buildDashboardEnvironment(env, discovered, storageRoot, ports) {
  return {
    ...env,
    DATABASE_URL: discovered.url,
    CONTENT_FACTORY_STORAGE_ROOT: storageRoot,
    DASHBOARD_API_HOST: env.DASHBOARD_API_HOST || '127.0.0.1',
    DASHBOARD_API_PORT: String(ports.apiPort),
    DASHBOARD_WEB_HOST: env.DASHBOARD_WEB_HOST || '127.0.0.1',
    DASHBOARD_WEB_PORT: String(ports.webPort),
  };
}

async function main() {
  const discovered = discoverLocalDatabase(process.env);
  const storageRoot = localStorageRoot(process.env);
  const ports = dashboardPorts(process.env);
  const host = process.env.DASHBOARD_API_HOST || '127.0.0.1';
  const webHost = process.env.DASHBOARD_WEB_HOST || '127.0.0.1';
  const db = new Pool({ connectionString: discovered.url, max: 2 });
  let readiness;
  let brandRegistry;
  try {
    // Local operator startup owns additive/idempotent schema verification so a merged
    // recovery feature cannot silently depend on a migration the operator forgot to run.
    await prepareDatabase(db);
    brandRegistry = await syncCanonicalBrands({
      db,
      workspaceId: process.env.CONTENT_FACTORY_WORKSPACE_ID || null,
    });
    readiness = await validateDashboardDatabase(db);
  } finally { await db.end(); }
  try { await fs.access(storageRoot, constants.R_OK | constants.W_OK); }
  catch (cause) {
    const error = new Error(`Content Factory storage is not readable/writable at '${storageRoot}'. Set CONTENT_FACTORY_STORAGE_ROOT to the production artifact root. ${cause.message}`);
    error.code = 'LOCAL_DASHBOARD_STORAGE_UNAVAILABLE';
    throw error;
  }
  await assertPortAvailable(host, ports.apiPort, 'Control API');
  await assertPortAvailable(webHost, ports.webPort, 'Dashboard');

  const childEnv = buildDashboardEnvironment(process.env, discovered, storageRoot, ports);
  console.log('LOCAL CONTENT FACTORY DASHBOARD READY');
  console.log(`Database: ${readiness.database} (${discovered.source})`);
  console.log(`Canonical brands: ${brandRegistry.canonicalCount} · workspace ${brandRegistry.workspaceId}`);
  console.log(`Storage root: ${storageRoot}`);
  console.log(`Dashboard: http://${webHost}:${ports.webPort}`);
  console.log(`Control API: http://${host}:${ports.apiPort}`);
  const child = spawn(process.execPath, [path.resolve('scripts/dashboard-dev.js')], { stdio: 'inherit', env: childEnv });
  child.on('error', (error) => { console.error(`[LOCAL_DASHBOARD_START_FAILED] ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if (signal) console.error(`Local dashboard stopped by ${signal}`);
    process.exitCode = code || 0;
  });
  const stop = (signal) => { if (!child.killed) child.kill(signal); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${error.code || 'LOCAL_DASHBOARD_ERROR'}] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertPortAvailable, buildDashboardEnvironment, dashboardPorts, validateDashboardDatabase };
