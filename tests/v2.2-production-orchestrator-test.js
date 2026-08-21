'use strict';

const assert = require('node:assert/strict');
const {
  buildProductionGraph,
  validateGraph,
  idempotencyKey,
  startProduction,
} = require('../worker/v2.2-production-orchestrator');
const { STAGE_ORDER } = require('../worker/v2.1-production-contract');

const graph = buildProductionGraph();
assert.deepEqual(graph.map((node) => node.stage), STAGE_ORDER);
assert.equal(graph[0].order, 1);
assert.equal(graph.at(-1).stage, 'LEARN');
assert.equal(validateGraph(graph), true);
assert.throws(() => validateGraph(graph.slice(0, -1)), /canonical V2\.1 stage sequence/);
assert.equal(idempotencyKey('ws-1', 'content-1'), 'v2.2:ws-1:content-1');

function dbMock() {
  const calls = [];
  const rows = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('FROM content_units')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO content_units')) return { rows: [{ id: 'content-1', status: 'planned' }], rowCount: 1 };
      if (sql.includes('INSERT INTO content_revisions')) return { rows: [{ id: 'revision-1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO production_nodes')) {
        const id = `node-${rows.length + 1}`;
        rows.push(id);
        return { rows: [{ id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

(async () => {
  const db = dbMock();
  const result = await startProduction(db, {
    workspaceId: 'ws-1',
    idea: 'A short film about a forgotten signal becoming a human story.',
    contentKey: 'signal-story-001',
    audience: 'general',
    goal: 'demonstrate autonomous production',
  });

  assert.equal(result.reused, false);
  assert.equal(result.contentUnitId, 'content-1');
  assert.equal(result.revisionId, 'revision-1');
  assert.equal(result.graph.length, 19);
  assert.equal(result.humanApprovalStage, 'HUMAN_APPROVAL');
  assert.deepEqual(result.repairStages, ['OBJECTIVE_QA', 'DELIVERY_QA']);
  assert.equal(db.calls[0].sql, 'BEGIN');
  assert.equal(db.calls.at(-1).sql, 'COMMIT');

  console.log('V2.2 production vertical slice bootstrap: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
