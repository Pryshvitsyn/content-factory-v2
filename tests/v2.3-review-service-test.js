'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ControlReviewService } = require('../src/v2.3/control-review-service');

const productionId = '22222222-2222-4222-8222-222222222222';
const brandId = '11111111-1111-4111-8111-111111111111';
const reviewId = '33333333-3333-4333-8333-333333333333';

class FakeDb {
  constructor() { this.items = []; this.decisions = []; this.queries = []; }
  async query(sql, values = []) {
    this.queries.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('v2.3:register-master-review')) {
      if (values[0] !== productionId || values[1] !== brandId) return { rows: [] };
      const existing = this.items.find((item) => item.production_id === values[0] && item.master_storage_key === values[4]);
      if (existing) return { rows: [] };
      const item = { id: this.items.length ? '44444444-4444-4444-8444-444444444444' : reviewId,
        production_id: values[0], brand_id: values[1], master_artifact_id: values[2], master_artifact_version: values[3], master_storage_key: values[4] };
      this.items.push(item); return { rows: [item] };
    }
    if (sql.includes('v2.3:get-master-review')) return { rows: this.items.filter((item) => item.production_id === values[0] && item.brand_id === values[1] && item.master_artifact_id === values[2] && item.master_storage_key === values[3]) };
    if (sql.includes('v2.3:lock-review-item')) return { rows: this.items.filter((item) => item.id === values[0] && item.brand_id === values[1]).map(({ id }) => ({ id })) };
    if (sql.includes('v2.3:get-review-decision')) return { rows: this.decisions.filter((item) => item.review_item_id === values[0]) };
    if (sql.includes('v2.3:insert-review-decision')) {
      const row = { id: `decision-${this.decisions.length + 1}`, review_item_id: values[0], decision: values[1], actor: values[2], reason: values[3] };
      this.decisions.push(row); return { rows: [row] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

function master(storageKey, contentHash) {
  return { artifact: { artifactId: `production:${productionId}:master`, version: 1, storageKey, contentHash, provenance: { provider: 'ffmpeg' } }, contentType: 'video/mp4', probe: { durationMs: 5000 } };
}
const quality = { status: 'PASS', score: 1, checks: [], readyForHumanReview: true, publicationAllowed: false };

async function main() {
  const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/20260823_v2_3_control_reviews.sql'), 'utf8');
  assert.match(sql, /master_artifact_version integer NOT NULL/);
  assert.match(sql, /master_storage_key text NOT NULL/);
  assert.match(sql, /master_content_hash text NOT NULL/);
  assert.match(sql, /master_review_decisions/);
  assert.match(sql, /review_item_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /human review history is append-only/);
  assert.doesNotMatch(sql, /ALTER TABLE v2_1\.(productions|jobs|stage_runs)/);
  assert.doesNotMatch(sql, /publications|publication_events/i);

  const db = new FakeDb(); const service = new ControlReviewService({ db });
  const v1 = await service.registerMasterForReview({ productionId, brandId, master: master('masters/v1.bin', 'hash-v1'), script: { hook: 'H', cta: 'C' }, quality });
  const approved = await service.decide({ reviewItemId: v1.id, brandId, decision: 'approve', actor: 'operator' });
  assert.equal(approved.decision, 'APPROVED'); assert.equal(approved.idempotent, false);
  const duplicate = await service.decide({ reviewItemId: v1.id, brandId, decision: 'approve', actor: 'operator' });
  assert.equal(duplicate.idempotent, true);
  await assert.rejects(() => service.decide({ reviewItemId: v1.id, brandId, decision: 'reject', actor: 'operator', reason: 'No' }), (error) => error.code === 'REVIEW_DECISION_CONFLICT');

  const v2 = await service.registerMasterForReview({ productionId, brandId, master: master('masters/v2.bin', 'hash-v2'), script: { hook: 'H2', cta: 'C2' }, quality });
  assert.notEqual(v1.id, v2.id, 'new immutable master must get a new review item');
  assert.equal(db.decisions.some((decision) => decision.review_item_id === v2.id), false, 'V2 must await a new decision');
  const rejected = await service.decide({ reviewItemId: v2.id, brandId, decision: 'reject', actor: 'operator', reason: 'Quality' });
  assert.equal(rejected.decision, 'REJECTED');
  assert.equal(db.decisions.length, 2, 'V1 history remains queryable after V2 decision');
  await assert.rejects(() => service.registerMasterForReview({ productionId, brandId: '99999999-9999-4999-8999-999999999999', master: master('masters/v3.bin', 'hash-v3'), quality }), (error) => error.code === 'BRAND_SCOPE_MISMATCH');
  assert.equal(db.queries.some((query) => /publication/i.test(query)), false, 'approval must not touch publication state');
  console.log('V2.3 durable exact-master review contract passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
