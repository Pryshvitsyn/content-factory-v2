'use strict';

const assert = require('node:assert/strict');
const { BODY_LIMIT } = require('../apps/dashboard/server/http-server');
const { validateDashboardDatabase } = require('../scripts/dashboard-local');
const { V210_MIGRATIONS } = require('../scripts/prepare-local-live-production');

async function main() {
  assert.equal(BODY_LIMIT, 1024 * 1024, 'normal QUALITY JSON requests need a durable 1 MB limit');

  const qualityMigration = V210_MIGRATIONS.indexOf('migrations/20260903_quality_script_first.sql');
  const retryMigration = V210_MIGRATIONS.indexOf('migrations/20260903_locked_stage_retry_history.sql');
  const motionPilotMigration = V210_MIGRATIONS.indexOf('migrations/20260904_avatar_motion_pilot.sql');
  const automaticQaMigration = V210_MIGRATIONS.indexOf('migrations/20260911_avatar_motion_pilot_automatic_qa.sql');
  const batchPreflightMigration = V210_MIGRATIONS.indexOf('migrations/20260912_avatar_motion_quality_batch_preflight.sql');
  assert(qualityMigration >= 0, 'dashboard/local preparation must auto-apply QUALITY script-first schema');
  assert(retryMigration > qualityMigration, 'append-only retry migration must run after QUALITY script-first schema');
  assert(motionPilotMigration > retryMigration, 'dashboard/local preparation must apply the Avatar Motion Pilot schema after prior additive migrations');
  assert(automaticQaMigration > motionPilotMigration, 'dashboard/local preparation must apply append-only automatic Motion QA schema');
  assert(batchPreflightMigration > automaticQaMigration, 'dashboard/local preparation must apply immutable Quality Batch preflight schema');

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
    motion_pilot_plans: true, motion_pilot_executions: true, motion_pilot_approvals: true, motion_pilot_attempts: true,
    motion_pilot_auto_qa: true, motion_pilot_quality_batches: true, motion_pilot_quality_batch_children: true, motion_pilot_quality_batch_preflights: true, motion_pilot_quality_batch_approvals: true,
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
    'avatar_studio.motion_pilot_plans',
    'avatar_studio.motion_pilot_executions',
    'avatar_studio.motion_pilot_execution_approvals',
    'avatar_studio.motion_pilot_attempts',
    'avatar_studio.motion_pilot_automatic_qa_assessments',
    'avatar_studio.motion_pilot_quality_batches',
    'avatar_studio.motion_pilot_quality_batch_children',
    'avatar_studio.motion_pilot_quality_batch_preflights',
    'avatar_studio.motion_pilot_quality_batch_approvals',
  ]) assert(readinessQuery.includes(table), `readiness must verify ${table}`);

  const missingDb = {
    async query() {
      return { rows: [{ ...readyState, motion_pilot_attempts: false }] };
    },
  };
  await assert.rejects(
    () => validateDashboardDatabase(missingDb),
    (error) => error.code === 'LOCAL_DASHBOARD_SCHEMA_MISSING'
      && error.message.includes('avatar_studio.motion_pilot_attempts'),
  );

  console.log('QUALITY runtime migration, readiness and JSON-size contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
