'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { PostgresSemanticEvaluationAttemptRepository } = require('../src/v2.9/semantic-evaluation-retry');

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_WORKSPACE_ID = '10000000-0000-4000-8000-000000000002';
const BRAND_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_BRAND_ID = '20000000-0000-4000-8000-000000000002';

function databaseName() { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.PGDATABASE; }
function safe() {
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || !databaseName() || databaseName() === 'content_os') {
    throw new Error('Semantic retry PostgreSQL test requires an explicitly disposable database');
  }
}
const db = new Pool({ connectionString: process.env.DATABASE_URL });
async function migration(name) { await db.query(await fs.readFile(path.resolve('migrations', name), 'utf8')); }

async function main() {
  safe();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await db.query('CREATE TABLE public.workspaces(id uuid PRIMARY KEY,name text NOT NULL)');
    await db.query('CREATE TABLE public.generation_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
    await migration('002_v2_1_execution.sql');
    await migration('20260822_v2_2_growth_foundation.sql');
    await migration('20260828_v2_9_2_semantic_evaluation_attempts.sql');
    await migration('20260828_v2_9_2_semantic_evaluation_attempts.sql');
    await migration('20260828_v2_9_2_1_semantic_retry_partial_media.sql');
    await migration('20260828_v2_9_2_1_semantic_retry_partial_media.sql');
    await db.query("INSERT INTO workspaces(id,name) VALUES($1,'one'),($2,'two')", [WORKSPACE_ID, OTHER_WORKSPACE_ID]);
    await db.query("INSERT INTO v2_2.brands(id,workspace_id,name,slug) VALUES($1,$2,'one','one'),($3,$4,'two','two')",
      [BRAND_ID, WORKSPACE_ID, OTHER_BRAND_ID, OTHER_WORKSPACE_ID]);
    const production = await db.query(`INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,objective)
      VALUES($1,$2,'semantic-test','FAILED','ENGAGEMENT') RETURNING id`, [WORKSPACE_ID, BRAND_ID]);
    const job = await db.query(`INSERT INTO v2_1.jobs(production_id,stage,status,idempotency_key,payload)
      VALUES($1,'EDIT','FAILED','semantic-test','{}') RETURNING id`, [production.rows[0].id]);
    const repository = new PostgresSemanticEvaluationAttemptRepository({ db });
    assert.equal((await repository.inspectSchema()).ready, true);
    const attempt = await repository.start({ workspaceId: WORKSPACE_ID, brandId: BRAND_ID,
      productionId: production.rows[0].id, jobId: job.rows[0].id, assetId: 'operator-video-1',
      sourceArtifact: { artifactId: 'brand:one:asset:operator-video-1', version: 1, contentHash: 'immutable' },
      previousEvidence: { status: 'FAIL', evidenceArtifact: { version: 1 } },
      evaluator: { provider: 'openai', model: 'semantic-test' },
      mediaPlan: { reusedVideoAssets: 1, reusedSpeechAssets: 0, possiblePostPassSpeechGenerations: 1 } });
    await repository.finish({ id: attempt.id, status: 'SUCCEEDED', resultEvidence: { status: 'PASS' },
      actualSemanticCalls: 1, reusedVideoAssets: 1, reusedSpeechAssets: 0,
      newSpeechGenerations: 1, newVideoGenerations: 0 });
    const preserved = await db.query('SELECT * FROM v2_9.semantic_evaluation_attempts WHERE id=$1', [attempt.id]);
    assert.equal(preserved.rows[0].expected_video_calls, 0);
    assert.equal(preserved.rows[0].expected_speech_calls, 0);
    assert.equal(preserved.rows[0].expected_semantic_calls, 1);
    assert.equal(preserved.rows[0].possible_post_pass_speech_calls, 1);
    assert.equal(preserved.rows[0].reused_video_assets, 1);
    assert.equal(preserved.rows[0].reused_speech_assets, 0);
    assert.equal(preserved.rows[0].new_speech_generations, 1);
    assert.equal(preserved.rows[0].new_video_generations, 0);
    assert.equal(preserved.rows[0].source_artifact.contentHash, 'immutable');
    await assert.rejects(() => db.query('UPDATE v2_9.semantic_evaluation_attempts SET brand_id=$2 WHERE id=$1',
      [attempt.id, OTHER_BRAND_ID]), /immutable|ownership mismatch/);
    await assert.rejects(() => db.query('DELETE FROM v2_9.semantic_evaluation_attempts WHERE id=$1', [attempt.id]),
      /cannot be deleted/);
    console.log('V2.9.2 semantic retry migration idempotence, attempt provenance, immutability, and brand isolation passed.');
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
