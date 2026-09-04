'use strict';

const assert = require('node:assert/strict');
const {
  discoverLocalDatabase,
  hasPlaceholder,
  parseContainerEnvironment,
} = require('../scripts/local-runtime');
const {
  buildDashboardEnvironment,
  dashboardPorts,
  validateDashboardDatabase,
} = require('../scripts/dashboard-local');

function dockerFixture(command, args) {
  assert.equal(command, 'docker');
  if (args[0] === 'inspect') return 'POSTGRES_USER=n8n\nPOSTGRES_PASSWORD=local-secret\nPOSTGRES_DB=n8n\n';
  if (args[0] === 'exec') return '1\n';
  if (args[0] === 'port') return '127.0.0.1:55432\n';
  throw new Error(`unexpected docker command: ${args.join(' ')}`);
}

function databaseUrl({ user, password, host, database }) {
  return ['postgresql://', user, ':', password, '@', host, ':5432/', database].join('');
}

async function main() {
  const placeholderUrl = databaseUrl({ user: 'USER', password: 'PASSWORD', host: 'HOST', database: 'content_os' });
  assert.equal(hasPlaceholder(placeholderUrl), true);
  assert.equal(hasPlaceholder(databaseUrl({ user: 'user', password: 'password', host: 'host', database: 'content_os' })), true);
  assert.equal(hasPlaceholder(databaseUrl({ user: 'n8n', password: 'secret', host: '127.0.0.1', database: 'content_os' })), false);
  assert.deepEqual(parseContainerEnvironment('A=one\nB=two=three\n'), { A: 'one', B: 'two=three' });

  const discovered = discoverLocalDatabase({ DATABASE_URL: placeholderUrl }, dockerFixture);
  assert.equal(discovered.database, 'content_os', 'local discovery must prefer the actual Content Factory database');
  assert.equal(discovered.source, 'docker:n8n-postgres-1');
  const parsed = new URL(discovered.url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '55432');
  assert.equal(parsed.pathname, '/content_os');
  assert.equal(parsed.username, 'n8n');
  assert.equal(parsed.password, 'local-secret');

  const explicit = discoverLocalDatabase({ DATABASE_URL: databaseUrl({
    user: 'operator', password: 'secret', host: 'db.local', database: 'factory',
  }) }, () => {
    throw new Error('Docker must not be inspected for an explicit real URL');
  });
  assert.equal(explicit.database, 'factory');
  assert.equal(explicit.source, 'DATABASE_URL');

  assert.deepEqual(dashboardPorts({ DASHBOARD_API_PORT: '3101', DASHBOARD_WEB_PORT: '3100' }), { apiPort: 3101, webPort: 3100 });
  assert.throws(() => dashboardPorts({ DASHBOARD_API_PORT: '3000', DASHBOARD_WEB_PORT: '3000' }),
    (error) => error.code === 'LOCAL_DASHBOARD_PORT_CONFLICT');
  assert.throws(() => dashboardPorts({ DASHBOARD_API_PORT: 'invalid' }),
    (error) => error.code === 'LOCAL_DASHBOARD_PORT_INVALID');

  const readiness = await validateDashboardDatabase({ query: async () => ({ rows: [{
    database: 'content_os', productions: true, brands: true, reviews: true,
    locked_workflows: true, locked_attempts: true, quality_scripts: true,
    quality_storyboards: true, quality_approvals: true, motion_pilot_plans: true,
    motion_pilot_executions: true, motion_pilot_approvals: true, motion_pilot_attempts: true,
  }] }) });
  assert.equal(readiness.database, 'content_os');
  await assert.rejects(() => validateDashboardDatabase({ query: async () => ({ rows: [{
    database: 'n8n', productions: false, brands: false, reviews: false,
    locked_workflows: false, locked_attempts: false, quality_scripts: false,
    quality_storyboards: false, quality_approvals: false,
  }] }) }), (error) => error.code === 'LOCAL_DASHBOARD_SCHEMA_MISSING'
    && /v2_10\.quality_script_revisions/.test(error.message)
    && /startup applies required additive migrations automatically/.test(error.message));

  const dashboardEnv = buildDashboardEnvironment({}, discovered, '/tmp/content-factory-storage', { apiPort: 3101, webPort: 3100 });
  assert.equal(dashboardEnv.DATABASE_URL, discovered.url);
  assert.equal(dashboardEnv.CONTENT_FACTORY_STORAGE_ROOT, '/tmp/content-factory-storage');
  assert.equal(dashboardEnv.DASHBOARD_API_PORT, '3101');
  assert.equal(dashboardEnv.DASHBOARD_WEB_PORT, '3100');
  assert.doesNotMatch(JSON.stringify({ database: discovered.database, source: discovered.source }), /local-secret/);
  console.log('V2.3 safe local runtime discovery and dashboard readiness passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
