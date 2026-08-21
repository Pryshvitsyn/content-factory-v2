'use strict';

const crypto = require('node:crypto');
const { STAGE_ORDER, assertStageTransition } = require('./v2.1-production-contract');

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new Error('db is required');
}

function idempotencyKey(workspaceId, contentKey) {
  return `v2.2:${workspaceId}:${contentKey}`;
}

function buildProductionGraph() {
  return STAGE_ORDER.map((stage, index) => ({
    nodeKey: stage.toLowerCase(),
    stage,
    order: index + 1,
    required: true,
  }));
}

function validateGraph(graph) {
  if (!Array.isArray(graph) || graph.length !== STAGE_ORDER.length) {
    throw new Error('Production graph must contain the canonical V2.1 stage sequence');
  }
  graph.forEach((node, index) => {
    if (node.stage !== STAGE_ORDER[index]) throw new Error(`Graph drift at stage ${index + 1}`);
    if (index > 0) assertStageTransition(graph[index - 1].stage, node.stage);
  });
  return true;
}

async function startProduction(db, {
  workspaceId,
  idea,
  contentKey,
  audience = null,
  goal = null,
  constraints = {},
  metadata = {},
} = {}) {
  requireDb(db);
  if (!workspaceId) throw new Error('workspaceId is required');
  if (typeof idea !== 'string' || idea.trim() === '') throw new Error('idea is required');
  if (typeof contentKey !== 'string' || contentKey.trim() === '') throw new Error('contentKey is required');

  const graph = buildProductionGraph();
  validateGraph(graph);
  const key = idempotencyKey(workspaceId, contentKey);

  await db.query('BEGIN');
  try {
    const existing = await db.query(
      `SELECT id, current_revision_id, status FROM content_units
        WHERE workspace_id = $1 AND content_key = $2`,
      [workspaceId, contentKey]
    );
    if (existing.rowCount) {
      await db.query('COMMIT');
      return { reused: true, contentUnitId: existing.rows[0].id, revisionId: existing.rows[0].current_revision_id, status: existing.rows[0].status, idempotencyKey: key };
    }

    const content = (await db.query(
      `INSERT INTO content_units
        (workspace_id, content_key, idea, audience, goal, constraints, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'planned')
       RETURNING id, status`,
      [workspaceId, contentKey, idea.trim(), audience, goal, JSON.stringify(constraints), JSON.stringify(metadata)]
    )).rows[0];

    const revision = (await db.query(
      `INSERT INTO content_revisions
        (content_unit_id, revision_no, revision_type, status)
       VALUES ($1, 1, 'initial', 'planned')
       RETURNING id`,
      [content.id]
    )).rows[0];

    await db.query(
      `UPDATE content_units SET current_revision_id = $1, updated_at = now() WHERE id = $2`,
      [revision.id, content.id]
    );

    const nodeIds = new Map();
    for (const node of graph) {
      const row = (await db.query(
        `INSERT INTO production_nodes
          (content_revision_id, node_key, node_type, status, required, config)
         VALUES ($1, $2, $3, 'planned', $4, $5::jsonb)
         RETURNING id`,
        [revision.id, node.nodeKey, node.stage, node.required, JSON.stringify({ stage: node.stage, order: node.order })]
      )).rows[0];
      nodeIds.set(node.stage, row.id);
    }

    for (let i = 1; i < graph.length; i += 1) {
      await db.query(
        `INSERT INTO production_edges(upstream_node_id, downstream_node_id, edge_type)
         VALUES ($1, $2, 'depends_on')`,
        [nodeIds.get(graph[i - 1].stage), nodeIds.get(graph[i].stage)]
      );
    }

    await db.query(
      `INSERT INTO production_rules(content_unit_id, rule_key, rule_type, severity, config)
       VALUES
         ($1, 'technical.integrity', 'objective', 'error', '{"mode":"deterministic"}'::jsonb),
         ($1, 'continuity.consistency', 'objective', 'error', '{"mode":"deterministic"}'::jsonb),
         ($1, 'artifact.deduplication', 'objective', 'error', '{"mode":"deterministic"}'::jsonb),
         ($1, 'platform.requirements', 'objective', 'error', '{"mode":"adapter"}'::jsonb)
       ON CONFLICT (content_unit_id, rule_key) DO NOTHING`,
      [content.id]
    );

    await db.query('COMMIT');
    return {
      reused: false,
      contentUnitId: content.id,
      revisionId: revision.id,
      status: content.status,
      idempotencyKey: key,
      graph,
      terminalStage: STAGE_ORDER[STAGE_ORDER.length - 1],
      humanApprovalStage: 'HUMAN_APPROVAL',
      repairStages: ['OBJECTIVE_QA', 'DELIVERY_QA'],
      runToken: crypto.createHash('sha256').update(key).digest('hex'),
    };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = {
  buildProductionGraph,
  validateGraph,
  idempotencyKey,
  startProduction,
};
