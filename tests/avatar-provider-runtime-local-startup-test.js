'use strict';

const assert = require('node:assert/strict');
const { V210_MIGRATIONS } = require('../scripts/prepare-local-live-production');
const { validateDashboardDatabase } = require('../scripts/dashboard-local');

const readyState = Object.freeze({
  database: 'avatar-runtime-local', productions: true, brands: true, reviews: true,
  locked_workflows: true, locked_attempts: true, quality_scripts: true, quality_storyboards: true, quality_approvals: true,
  motion_pilot_plans: true, motion_pilot_executions: true, motion_pilot_approvals: true, motion_pilot_attempts: true,
  motion_pilot_auto_qa: true, motion_pilot_quality_batches: true, motion_pilot_quality_batch_children: true,
  motion_pilot_quality_batch_preflights: true, motion_pilot_quality_batch_approvals: true, provider_reference_canonicals: true,
  avatar_performance_captures: true, avatar_provider_bindings: true, avatar_performance_executions: true,
  avatar_provider_pricing_evidence: true, avatar_pricing_provider_engine: true, avatar_pricing_operation: true,
  avatar_pricing_billing_unit: true, avatar_pricing_credit_to_operation_rule: true,
});

async function main() {
  const runtime = V210_MIGRATIONS.indexOf('migrations/20260914_avatar_provider_runtime.sql');
  const pricing = V210_MIGRATIONS.indexOf('migrations/20260915_avatar_provider_pricing_evidence.sql');
  const routeScope = V210_MIGRATIONS.indexOf('migrations/20260916_avatar_provider_pricing_route_scope.sql');
  assert(runtime >= 0 && pricing === runtime + 1 && routeScope === pricing + 1,
    'local preparation must apply 20260914 → 20260915 → 20260916 in dependency order');

  let query = '';
  await validateDashboardDatabase({ query: async (sql) => { query = String(sql); return { rows: [readyState] }; } });
  for (const table of ['avatar_studio.performance_captures', 'avatar_studio.avatar_provider_bindings',
    'avatar_studio.avatar_performance_executions', 'avatar_studio.avatar_provider_pricing_evidence']) {
    assert(query.includes(table), `dashboard startup must verify ${table}`);
  }
  for (const column of ['provider_engine', 'operation', 'billing_unit', 'credit_to_operation_rule']) {
    assert(query.includes(`column_name='${column}'`), `dashboard startup must verify pricing ${column}`);
  }
  for (const [key, expected] of [
    ['avatar_provider_pricing_evidence', 'avatar_studio.avatar_provider_pricing_evidence'],
    ['avatar_pricing_operation', 'avatar_studio.avatar_provider_pricing_evidence.operation'],
  ]) await assert.rejects(
    () => validateDashboardDatabase({ query: async () => ({ rows: [{ ...readyState, [key]: false }] }) }),
    (error) => error.code === 'LOCAL_DASHBOARD_SCHEMA_MISSING' && error.message.includes(expected),
  );
  console.log('Avatar Provider Runtime local migration completeness and startup schema guard passed; provider calls = 0.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
