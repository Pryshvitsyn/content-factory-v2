'use strict';

const { Client } = require('pg');
require('dotenv').config();

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

const REQUIRED_TABLES = ['projects','productions','jobs','stage_definitions','stage_runs','generation_runs','artifacts','artifact_versions','production_bibles','shots','asset_requirements','events'];
const REQUIRED_FUNCTIONS = ['recover_expired_work','claim_job','claim_job_for_production','claim_stage','heartbeat_job','heartbeat_stage','enforce_planning_boundary','prevent_planning_definition_mutation'];

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='v2_1' AND table_name=ANY($1::text[])`, [REQUIRED_TABLES]);
    const actualTables = new Set(tables.rows.map((row) => row.table_name));
    for (const table of REQUIRED_TABLES) if (!actualTables.has(table)) throw new Error(`Missing V2.1 table: ${table}`);

    const artifactColumn = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='v2_1' AND table_name='generation_runs' AND column_name='artifact_id'`);
    if (!artifactColumn.rowCount) throw new Error('generation_runs.artifact_id is missing from the canonical V2.1 schema');

    const functions = await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='v2_1' AND p.proname=ANY($1::text[])`, [REQUIRED_FUNCTIONS]);
    const actualFunctions = new Set(functions.rows.map((row) => row.proname));
    for (const fn of REQUIRED_FUNCTIONS) if (!actualFunctions.has(fn)) throw new Error(`Missing V2.1 database function: ${fn}`);

    const triggers = await client.query(`SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT tg.tgisinternal AND n.nspname='v2_1'`);
    const actualTriggers = new Set(triggers.rows.map((row) => row.tgname));
    for (const trigger of ['trg_stage_runs_output_contract','trg_generation_runs_audit','trg_production_bible_boundary','trg_production_bible_immutable','trg_shots_planning_boundary','trg_asset_requirements_planning_boundary','trg_shots_planning_immutable','trg_asset_requirements_planning_immutable']) {
      if (!actualTriggers.has(trigger)) throw new Error(`Missing V2.1 database trigger: ${trigger}`);
    }

    const stages = await client.query(`SELECT stage, requires, outputs, parallel_group FROM v2_1.stage_definitions WHERE stage IN ('BIBLE','SHOT_PLAN','ASSET_PLAN') ORDER BY stage`);
    const byStage = new Map(stages.rows.map((row) => [row.stage, row]));
    if (JSON.stringify(byStage.get('BIBLE')?.requires) !== JSON.stringify(['SCRIPT'])) throw new Error('BIBLE dependency contract is incorrect');
    if (JSON.stringify(byStage.get('SHOT_PLAN')?.requires) !== JSON.stringify(['PRODUCTION_BIBLE','SCRIPT'])) throw new Error('SHOT_PLAN dependency contract is incorrect');
    if (JSON.stringify(byStage.get('ASSET_PLAN')?.requires) !== JSON.stringify(['PRODUCTION_BIBLE','SHOTS'])) throw new Error('ASSET_PLAN dependency contract is incorrect');
    if (JSON.stringify(byStage.get('SHOT_PLAN')?.outputs) !== JSON.stringify(['SHOTS'])) throw new Error('SHOT_PLAN output contract is incorrect');
    if (JSON.stringify(byStage.get('ASSET_PLAN')?.outputs) !== JSON.stringify(['ASSET_REQUIREMENTS'])) throw new Error('ASSET_PLAN output contract is incorrect');

    const artifactConstraint = await client.query(`SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='v2_1' AND r.relname='artifacts' AND c.conname='artifacts_artifact_type_check'`);
    if (artifactConstraint.rowCount !== 1 || !artifactConstraint.rows[0].definition.includes('PRODUCTION_BIBLE') || !artifactConstraint.rows[0].definition.includes('SHOTS') || !artifactConstraint.rows[0].definition.includes('ASSET_REQUIREMENTS')) throw new Error('Planning artifact types are not present in the canonical artifact type constraint');

    console.log('V2.1 MIGRATION CONTRACT DATABASE SMOKE TEST PASSED.');
    console.log('CLEAN V2.1 TABLE SET VERIFIED.');
    console.log('GENERATION AUDIT ARTIFACT COLUMN VERIFIED BEFORE TRIGGERS.');
    console.log('EXECUTION + PRODUCTION-SCOPED CLAIM FUNCTIONS VERIFIED.');
    console.log('BIBLE + PLANNING BOUNDARY TRIGGERS VERIFIED.');
    console.log('BIBLE -> SHOT_PLAN -> ASSET_PLAN DEPENDENCY CONTRACT VERIFIED.');
    console.log('PLANNING ARTIFACT TYPE CONTRACT VERIFIED.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 MIGRATION CONTRACT DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
