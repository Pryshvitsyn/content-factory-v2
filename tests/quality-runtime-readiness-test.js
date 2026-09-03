'use strict';

const assert = require('node:assert/strict');
const { BODY_LIMIT } = require('../apps/dashboard/server/http-server');
const { validateDashboardDatabase } = require('../scripts/dashboard-local');
const { V210_MIGRATIONS } = require('../scripts/prepare-local-live-production');

async function main() {
  assert.equal(BODY_LIMIT, 1024 * 1024, 'normal QUALITY JSON requests need a durable 1 MB limit');

  const qualityMigration = V210_MIGRATIONS.indexOf('migrations/20260903_quality_script_first.sql');
  const retryMigration = V210_MIGRATIONS.indexOf('migrations/20260903_locked_stage_retry_history.sql');
  assert(qualityMigration >= 0, 'dashboard/local preparation must auto-apply QUALITY script-first schema');
  assert(retryMigration > qualityMigration, 'append-only retry migration must run after QUALITY script-first schema');

  const readyState = {
    database: 'test',
    productions: true,
    brands: true,
    reviews: true,
    locked_workflows: true,
    locked_attempts: true,
    quality_scripts: true,
    quality_storyboards: true,
    quality_approvals: true,
  };
  let readinessQuery = '';
  const readyDb = {
    async query(sql) {
      readinessQuery = String(sql);
      return { rows: [readyState] };
    },
  };
  const state = await validateDashboardDatabase(readyDb);
  assert.equal(state.database, 'test');
  for (const table of [
    'v2_10.locked_keyframe_workflows',
    'v2_10.locked_stage_attempts',
    'v2_10.quality_script_revisions',
    'v2_10.quality_storyboard_revisions',
    'v2_10.quality_stage_approval_events',
  ]) assert(readinessQuery.includes(table), `readiness must verify ${table}`);

  const missingDb = {
    async query() {
      return { rows: [{ ...readyState, quality_approvals: false }] };
    },
  };
  await assert.rejects(
    () => validateDashboardDatabase(missingDb),
    (error) => error.code === 'LOCAL_DASHBOARD_SCHEMA_MISSING'
      && error.message.includes('v2_10.quality_stage_approval_events'),
  );

  console.log('QUALITY runtime migration, readiness and JSON-size contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
