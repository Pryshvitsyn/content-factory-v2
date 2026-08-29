'use strict';

const assert = require('node:assert/strict');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { stableFingerprint } = require('../src/v2.5/production-input');
const { V210_EXECUTION_IDENTITY_VERSION, revisionSafeProductionKey } = require('../src/v2.10/integrated-starter');

const W = '31000000-0000-4000-8000-000000000001';
const B = '31000000-0000-4000-8000-000000000011';
const DRAFT = '31000000-0000-4000-8000-000000000021';
const ACTOR = 'operator-live-collision-certification';

class FakeDb {
  constructor() {
    this.productions = new Map();
    this.jobs = new Map();
    this.nextId = 1;
  }

  productionMapKey(workspaceId, name) { return `${workspaceId ?? '__NULL__'}:${name}`; }
  jobMapKey(productionId, key) { return `${productionId}:${key}`; }

  seedProduction(row) {
    this.productions.set(this.productionMapKey(row.workspace_id, row.name), structuredClone(row));
  }

  async query(sql, params = []) {
    if (sql.includes('v2.4:create-production')) {
      const [workspaceId, brandId, name, objective, metadataJson] = params;
      const key = this.productionMapKey(workspaceId, name);
      if (this.productions.has(key)) return { rows: [] };
      const row = { id: `production-${this.nextId++}`, workspace_id: workspaceId, brand_id: brandId,
        name, status: 'DRAFT', objective, metadata: JSON.parse(metadataJson) };
      this.productions.set(key, row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('v2.4:get-production-for-run')) {
      const [workspaceId, name] = params;
      // PostgreSQL `WHERE workspace_id = NULL` never matches. The operator's
      // legacy v2_1.productions schema allows NULL, so emulate that exact
      // behavior instead of JavaScript Map equality.
      if (workspaceId == null) return { rows: [] };
      const row = this.productions.get(this.productionMapKey(workspaceId, name));
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.includes('v2.4:create-live-job')) {
      const [productionId, idempotencyKey, payloadJson] = params;
      const key = this.jobMapKey(productionId, idempotencyKey);
      if (this.jobs.has(key)) return { rows: [] };
      const row = { id: `job-${this.nextId++}`, production_id: productionId, stage: 'EDIT', status: 'QUEUED',
        idempotency_key: idempotencyKey, payload: JSON.parse(payloadJson), result: null };
      this.jobs.set(key, row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('v2.4:get-live-job')) {
      const [productionId, idempotencyKey] = params;
      const row = this.jobs.get(this.jobMapKey(productionId, idempotencyKey));
      return { rows: row ? [structuredClone(row)] : [] };
    }
    throw new Error(`Unexpected SQL in collision-guard certification: ${sql}`);
  }
}

function oldR1ProductionKey(draftId, canonicalInput) {
  const source = { ...canonicalInput };
  delete source.fingerprint;
  delete source.productionKey;
  delete source.liveTestKey;
  return `v210-${draftId}-${stableFingerprint(source).slice(0, 16)}`;
}

function withProductionKey(base, key) {
  const normalized = { ...base, productionKey: key, liveTestKey: key };
  delete normalized.fingerprint;
  return Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
}

async function main() {
  const db = new FakeDb();
  const live = new LiveProductionService({ db, rendererRouter: {},
    artifactService: { createVersion() {} }, storageRoot: '/not-used' });
  const base = Object.freeze({ schemaVersion: 3, workspaceId: W, brandId: B,
    productionKey: `v210-${DRAFT}`, liveTestKey: `v210-${DRAFT}`, productionNamespace: 'v2.7-operator',
    objective: 'EXPERIMENT', renderMode: 'QUALITY', renderer: 'v2.5-quality',
    publicationPolicy: { requiresHumanApproval: true, autoPublish: false } });
  const command = Object.freeze({ source: 'v2.7-operator-console', requestId: DRAFT, actor: ACTOR,
    canonicalRawInput: { schema_version: '2.6' }, canonicalRequest: { requestId: DRAFT } });
  const config = Object.freeze({ provider: 'replicate', model: 'alibaba/wan-3' });

  // Reproduce the operator's actual legacy-schema failure: START previously
  // called createDraft() with no workspaceId. A nullable workspace column lets
  // the INSERT happen, but the immediate `workspace_id = NULL` lookup cannot
  // retrieve it, so LiveProductionService throws the exact observed conflict.
  const unscopedBase = { ...base };
  delete unscopedBase.workspaceId;
  const unscopedIdentity = revisionSafeProductionKey(DRAFT, unscopedBase);
  const unscopedInput = withProductionKey(unscopedBase, unscopedIdentity.productionKey);
  await assert.rejects(() => live.ensureDraftRows(db, { input: unscopedInput, config, command }), (error) => {
    assert.equal(error.code, 'LIVE_INPUT_CONFLICT');
    assert.equal(error.message, 'Existing production does not match brand or structured input');
    return true;
  }, 'nullable legacy workspace schema must reproduce the exact operator START failure when canonical input is unscoped');
  db.productions.delete(db.productionMapKey(null, `v2.7-operator:${unscopedIdentity.productionKey}`));

  const oldKey = oldR1ProductionKey(DRAFT, base);
  const oldInput = withProductionKey(base, oldKey);
  const oldName = `v2.7-operator:${oldKey}`;
  db.seedProduction({ id: 'stale-production', workspace_id: W, brand_id: B, name: oldName, status: 'DRAFT',
    objective: 'EXPERIMENT', metadata: { live_input_fingerprint: 'different-structured-input',
      operator_request_id: DRAFT, operator_actor: ACTOR } });

  await assert.rejects(() => live.ensureDraftRows(db, { input: oldInput, config, command }), (error) => {
    assert.equal(error.code, 'LIVE_INPUT_CONFLICT');
    assert.equal(error.message, 'Existing production does not match brand or structured input');
    return true;
  }, 'certification must reproduce the stale-canonical guard failure separately from workspace scoping');

  const currentIdentity = revisionSafeProductionKey(DRAFT, base);
  assert.equal(currentIdentity.executionIdentityVersion, V210_EXECUTION_IDENTITY_VERSION);
  assert.equal(V210_EXECUTION_IDENTITY_VERSION, 'r2');
  assert.match(currentIdentity.productionKey, new RegExp(`^v210-${DRAFT}-[a-f0-9]{16}$`));
  assert.notEqual(currentIdentity.productionKey, oldKey,
    'r2 identity salt must move a safe retry away from a contaminated r1 canonical row');

  const currentInput = withProductionKey(base, currentIdentity.productionKey);
  const created = await live.ensureDraftRows(db, { input: currentInput, config, command });
  assert.equal(created.created, true);
  assert.equal(created.production.workspace_id, W, 'canonical row must be durably workspace scoped');
  assert.equal(created.production.metadata.live_input_fingerprint, currentInput.fingerprint);
  assert.equal(created.production.brand_id, B);
  assert.equal(created.job.payload.inputFingerprint, currentInput.fingerprint);
  assert.equal(created.job.payload.operatorRequestId, DRAFT);
  assert.ok(db.productions.has(db.productionMapKey(W, oldName)), 'stale forensic row must remain untouched');
  assert.ok(db.productions.has(db.productionMapKey(W, `v2.7-operator:${currentIdentity.productionKey}`)),
    'safe retry must create a distinct canonical row through the real LiveProductionService guard');

  const reused = await live.ensureDraftRows(db, { input: currentInput, config, command });
  assert.equal(reused.created, false, 'same exact r2 input remains idempotent');
  assert.equal(reused.production.id, created.production.id);
  assert.equal(reused.job.id, created.job.id);

  console.log('V2.10 real LiveProductionService guard reproduced both nullable-workspace and stale-row conflicts; workspace-scoped exact retry remains idempotent. Provider calls = 0.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
