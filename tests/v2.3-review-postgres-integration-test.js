'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { ControlReviewService } = require('../src/v2.3/control-review-service');
const { ControlRepository } = require('../apps/dashboard/server/control-repository');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST || '127.0.0.1',
  port: process.env.DATABASE_URL ? undefined : Number(process.env.PGPORT || 5432),
  user: process.env.DATABASE_URL ? undefined : process.env.PGUSER || 'postgres',
  password: process.env.DATABASE_URL ? undefined : process.env.PGPASSWORD || 'postgres',
  database: process.env.DATABASE_URL ? undefined : process.env.PGDATABASE || 'content_os',
});

const migration = (name) => fs.readFileSync(path.resolve(__dirname, '..', 'migrations', name), 'utf8');
const quality = { status: 'PASS', score: 1, checks: [{ code: 'technical', status: 'PASS' }], readyForHumanReview: true, publicationAllowed: false };

function master(productionId, key) {
  return { artifact: { artifactId: `production:${productionId}:master`, version: 1, storageKey: `artifacts/${productionId}/${key}.bin`, contentHash: `hash-${key}`, provenance: { provider: 'ffmpeg' } }, contentType: 'video/mp4', probe: { durationMs: 1000 } };
}

async function main() {
  const workspaceId = crypto.randomUUID(); const brandId = crypto.randomUUID(); const productionId = crypto.randomUUID();
  const legacyProductionId = crypto.randomUUID();
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, name text NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS generation_jobs (id uuid PRIMARY KEY)');
  await pool.query(migration('002_v2_1_execution.sql'));
  await pool.query(migration('20260822_v2_2_growth_foundation.sql'));
  await pool.query(migration('20260822_v2_2_brand_brain_opportunities.sql'));
  await pool.query(migration('20260821_v2_1_asset_registry.sql'));
  await pool.query(migration('20260823_v2_3_control_reviews.sql'));
  await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [workspaceId, 'V2.3 test workspace']);
  await pool.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug) VALUES($1,$2,'Brand','brand')`, [brandId, workspaceId]);
  await pool.query(`INSERT INTO v2_1.productions(id,workspace_id,brand_id,name) VALUES($1,$2,$3,'reviewed'),($4,$2,NULL,'legacy-valid')`, [productionId, workspaceId, brandId, legacyProductionId]);

  const service = new ControlReviewService({ db: pool });
  const repository = new ControlRepository({ db: pool });
  const jobId = crypto.randomUUID();
  await pool.query(`INSERT INTO v2_1.jobs(id,production_id,stage,status,idempotency_key) VALUES($1,$2,'SIGNAL','RUNNING',$3)`, [jobId, productionId, `review-test:${jobId}`]);
  await pool.query(`INSERT INTO v2_1.stage_runs(job_id,stage,status,worker_id,metadata) VALUES($1,'SIGNAL','RUNNING','review-test',$2::jsonb)`, [jobId, JSON.stringify({ provider: 'nvidia', model: 'nemotron' })]);
  await pool.query(`INSERT INTO v2_1.asset_registry(production_id,asset_id,kind,semantic_key,artifact_storage_key,artifact_version,created_by)
    VALUES($1,'asset-1','video','asset-1','artifacts/asset-1.bin',1,'review-test')`, [productionId]);
  const v1 = await service.registerMasterForReview({ productionId, brandId, master: master(productionId, 'v1'), script: { hook: 'one', cta: 'go' }, quality });
  const approval = await service.decide({ reviewItemId: v1.id, brandId, decision: 'approve', actor: 'postgres-test' });
  assert.equal(approval.decision, 'APPROVED');
  const duplicate = await service.decide({ reviewItemId: v1.id, brandId, decision: 'approve', actor: 'postgres-test' });
  assert.equal(duplicate.idempotent, true);

  const v2 = await service.registerMasterForReview({ productionId, brandId, master: master(productionId, 'v2'), script: { hook: 'two', cta: 'go' }, quality });
  assert.notEqual(v1.id, v2.id);
  const pendingV2 = await pool.query('SELECT count(*)::int AS count FROM v2_3.master_review_decisions WHERE review_item_id=$1', [v2.id]);
  assert.equal(pendingV2.rows[0].count, 0, 'new master version requires review');
  const rejection = await service.decide({ reviewItemId: v2.id, brandId, decision: 'reject', actor: 'postgres-test', reason: 'Not acceptable' });
  assert.equal(rejection.decision, 'REJECTED');
  const history = await pool.query('SELECT decision FROM v2_3.master_review_decisions WHERE review_item_id IN ($1,$2) ORDER BY decided_at', [v1.id, v2.id]);
  assert.deepEqual(new Set(history.rows.map((row) => row.decision)), new Set(['APPROVED','REJECTED']));

  const v3 = await service.registerMasterForReview({ productionId, brandId, master: master(productionId, 'v3'), quality });
  const race = await Promise.allSettled([
    service.decide({ reviewItemId: v3.id, brandId, decision: 'approve', actor: 'race-a' }),
    service.decide({ reviewItemId: v3.id, brandId, decision: 'reject', actor: 'race-b', reason: 'race' }),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter((result) => result.status === 'rejected' && result.reason.code === 'REVIEW_DECISION_CONFLICT').length, 1);
  const terminal = await pool.query('SELECT count(*)::int AS count FROM v2_3.master_review_decisions WHERE review_item_id=$1', [v3.id]);
  assert.equal(terminal.rows[0].count, 1);

  const v4 = await service.registerMasterForReview({ productionId, brandId, master: master(productionId, 'v4'), quality });
  const health = await repository.health(); assert.ok(health.databaseTime);
  const overview = await repository.overview();
  assert.ok(overview.totalBrands >= 1); assert.ok(overview.runningJobs >= 1); assert.ok(overview.awaitingReview >= 1);
  const brands = await repository.listBrands(); assert.ok(brands.some((brand) => brand.id === brandId));
  const brand = await repository.getBrand(brandId); assert.equal(brand.id, brandId); assert.ok(Array.isArray(brand.products));
  const productions = await repository.listProductions({ brandId }); assert.ok(productions.some((production) => production.id === productionId));
  const production = await repository.getProduction(productionId, brandId); assert.equal(production.brandId, brandId);
  assert.equal(await repository.getProduction(productionId, crypto.randomUUID()), null, 'production brand mismatch denied');
  const stages = await repository.listStages(productionId, brandId); assert.equal(stages.length, 15); assert.equal(stages[0].provider, 'nvidia');
  const artifacts = await repository.listArtifacts(productionId, brandId); assert.ok(artifacts.some((artifact) => artifact.artifactId === 'asset-1'));
  assert.ok(artifacts.some((artifact) => artifact.sourceId === v4.id && artifact.reviewState === 'AWAITING_HUMAN_APPROVAL'));
  const queue = await repository.listReviews({ brandId }); assert.deepEqual(queue.map((item) => item.id), [v4.id]);
  const historyRows = await repository.listReviews({ brandId, includeDecided: true }); assert.ok(historyRows.length >= 4);
  const resolved = await repository.resolveArtifact({ sourceId: v4.id, artifactId: v4.master_artifact_id, version: v4.master_artifact_version, brandId });
  assert.equal(resolved.storageKey, v4.master_storage_key);
  const deniedArtifact = await repository.resolveArtifact({ sourceId: v4.id, artifactId: v4.master_artifact_id, version: v4.master_artifact_version, brandId: crypto.randomUUID() });
  assert.equal(deniedArtifact, null, 'artifact brand mismatch denied');

  await assert.rejects(() => service.registerMasterForReview({ productionId, brandId: crypto.randomUUID(), master: master(productionId, 'wrong-brand'), quality }), (error) => error.code === 'BRAND_SCOPE_MISMATCH');
  const legacy = await pool.query('SELECT id,status FROM v2_1.productions WHERE id=$1', [legacyProductionId]);
  assert.equal(legacy.rows[0].status, 'DRAFT', 'existing production without review remains valid');
  const publicationTable = await pool.query(`SELECT to_regclass('v2_1.publications') AS name`);
  if (publicationTable.rows[0].name) {
    const publications = await pool.query('SELECT count(*)::int AS count FROM v2_1.publications WHERE production_run_id=$1', [productionId]);
    assert.equal(publications.rows[0].count, 0, 'human approval does not publish');
  }
  console.log('V2.3 PostgreSQL review concurrency and history integration passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
