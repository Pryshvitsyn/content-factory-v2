'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function hasPlaceholder(url) {
  return !url || /(?:USER|PASSWORD|HOST)/i.test(url);
}

function parseContainerEnvironment(raw) {
  return Object.fromEntries(String(raw || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
  }));
}

function inspectContainerEnvironment(container, execute = execFileSync) {
  return parseContainerEnvironment(execute(
    'docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container], { encoding: 'utf8' },
  ));
}

function containerDatabaseExists(container, user, database, execute = execFileSync) {
  if (!/^[A-Za-z0-9_.-]+$/.test(database)) return false;
  try {
    const escaped = database.replace(/'/g, "''");
    return execute('docker', [
      'exec', container, 'psql', '-U', user, '-d', 'postgres', '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${escaped}'`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === '1';
  } catch { return false; }
}

function containerPostgresPort(container, execute = execFileSync) {
  try {
    const raw = execute('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
    return Number(raw.match(/:(\d+)$/m)?.[1] || 5432);
  } catch { return 5432; }
}

function discoverLocalDatabase(env = process.env, execute = execFileSync) {
  if (!hasPlaceholder(env.DATABASE_URL)) {
    const parsed = new URL(env.DATABASE_URL);
    return { url: env.DATABASE_URL, database: decodeURIComponent(parsed.pathname.replace(/^\//, '')), source: 'DATABASE_URL' };
  }

  const container = env.CONTENT_FACTORY_POSTGRES_CONTAINER || 'n8n-postgres-1';
  let values;
  try { values = inspectContainerEnvironment(container, execute); }
  catch (cause) {
    const error = new Error(`Unable to discover local PostgreSQL from Docker container '${container}'. Provide a real DATABASE_URL. ${cause.message}`);
    error.code = 'LOCAL_DB_DISCOVERY_FAILED';
    throw error;
  }
  const user = values.POSTGRES_USER || 'postgres';
  const password = values.POSTGRES_PASSWORD || '';
  const explicit = env.CONTENT_FACTORY_DATABASE;
  const database = explicit || (containerDatabaseExists(container, user, 'content_os', execute)
    ? 'content_os' : (values.POSTGRES_DB || 'postgres'));
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return {
    url: `postgresql://${auth}@127.0.0.1:${containerPostgresPort(container, execute)}/${encodeURIComponent(database)}`,
    database,
    source: `docker:${container}`,
  };
}

function localStorageRoot(env = process.env) {
  return path.resolve(env.CONTENT_FACTORY_STORAGE_ROOT || path.join(os.homedir(), '.content-factory', 'storage'));
}

module.exports = {
  containerDatabaseExists,
  containerPostgresPort,
  discoverLocalDatabase,
  hasPlaceholder,
  inspectContainerEnvironment,
  localStorageRoot,
  parseContainerEnvironment,
};
