'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'migrations/002_content_production_contract.sql'),
  'utf8'
);

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function main() {
  const db = client();
  await db.connect();

  try {
    await db.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS workspaces (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_providers (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_models (
        id uuid PRIMARY KEY,
        provider_id uuid REFERENCES ai_providers(id),
        model_id text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES workspaces(id)
      );
      CREATE TABLE IF NOT EXISTS job_stages (
        id uuid PRIMARY KEY,
        pipeline_run_id uuid REFERENCES pipeline_runs(id)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        pipeline_run_id uuid REFERENCES pipeline_runs(id),
        stage_id uuid REFERENCES job_stages(id),
        provider_id uuid REFERENCES ai_providers(id),
        model_id uuid REFERENCES ai_models(id),
        artifact_type text NOT NULL,
        logical_key text NOT NULL,
        version integer NOT NULL
      );
    `);

    await db.query(migration);

    const requiredTables = [
      'content_units', 'content_revisions', 'production_nodes', 'production_edges',
      'artifact_lineage', 'production_rules', 'human_reviews', 'content_masters',
      'qa_findings', 'delivery_adapters', 'delivery_policies', 'delivery_packages',
      'publication_attempts', 'artifact_provenance',
    ];

    for (const table of requiredTables) {
      const result = await db.query(`SELECT to_regclass($1) AS relation`, [table]);
      assert.equal(result.rows[0].relation, table, `${table} must exist`);
    }

    const workspaceId = '00000000-0000-0000-0000-000000000001';
    const providerId = '00000000-0000-0000-0000-000000000002';
    const modelId = '00000000-0000-0000-0000-000000000003';
    const runId = '00000000-0000-0000-0000-000000000004';
    const stageId = '00000000-0000-0000-0000-000000000005';
    const artifactId = '00000000-0000-0000-0000-000000000006';

    await db.query(`INSERT INTO workspaces(id, name) VALUES ($1, 'production-contract-cert')`, [workspaceId]);
    await db.query(`INSERT INTO ai_providers(id, name) VALUES ($1, 'cert-provider')`, [providerId]);
    await db.query(`INSERT INTO ai_models(id, provider_id, model_id) VALUES ($1, $2, 'cert-model')`, [modelId, providerId]);
    await db.query(`INSERT INTO pipeline_runs(id, workspace_id) VALUES ($1, $2)`, [runId, workspaceId]);
    await db.query(`INSERT INTO job_stages(id, pipeline_run_id) VALUES ($1, $2)`, [stageId, runId]);
    await db.query(
      `INSERT INTO artifacts(id, workspace_id, pipeline_run_id, stage_id, artifact_type, logical_key, version)
       VALUES ($1, $2, $3, $4, 'master', 'cert-master', 1)`,
      [artifactId, workspaceId, runId, stageId]
    );

    const content = (await db.query(
      `INSERT INTO content_units(workspace_id, content_key, idea, audience, goal)
       VALUES ($1, 'cert-content', 'Make a production contract test video', 'developers', 'validation')
       RETURNING id`,
      [workspaceId]
    )).rows[0];

    const revision = (await db.query(
      `INSERT INTO content_revisions(content_unit_id, revision_no)
       VALUES ($1, 1) RETURNING id`,
      [content.id]
    )).rows[0];

    await db.query(`UPDATE content_units SET current_revision_id=$1 WHERE id=$2`, [revision.id, content.id]);

    const nodes = await db.query(
      `INSERT INTO production_nodes(content_revision_id, node_key, node_type)
       VALUES ($1, 'master', 'canonical_master'), ($1, 'delivery', 'delivery_package')
       RETURNING id, node_key`,
      [revision.id]
    );
    const masterNode = nodes.rows.find((row) => row.node_key === 'master');
    const deliveryNode = nodes.rows.find((row) => row.node_key === 'delivery');

    await db.query(
      `INSERT INTO production_edges(upstream_node_id, downstream_node_id) VALUES ($1, $2)`,
      [masterNode.id, deliveryNode.id]
    );

    const adapter = (await db.query(
      `INSERT INTO delivery_adapters(adapter_key, adapter_version, target_type)
       VALUES ('cert-target', '1.0.0', 'generic') RETURNING id`
    )).rows[0];
    const policy = (await db.query(
      `INSERT INTO delivery_policies(adapter_id, policy_key, version)
       VALUES ($1, 'cert-policy', '1.0.0') RETURNING id`,
      [adapter.id]
    )).rows[0];

    // Human approval must exist before an approved master can exist.
    const review = (await db.query(
      `INSERT INTO human_reviews(content_unit_id, content_revision_id, artifact_id, decision, reviewer)
       VALUES ($1, $2, $3, 'approve', 'cert') RETURNING id`,
      [content.id, revision.id, artifactId]
    )).rows[0];

    const master = (await db.query(
      `INSERT INTO content_masters(content_unit_id, content_revision_id, artifact_id, human_review_id, qa_passed_at, status)
       VALUES ($1, $2, $3, $4, now(), 'approved') RETURNING id`,
      [content.id, revision.id, artifactId, review.id]
    )).rows[0];

    const packageRow = await db.query(
      `INSERT INTO delivery_packages(content_unit_id, content_master_id, master_artifact_id, policy_id, status, validation_state)
       VALUES ($1, $2, $3, $4, 'ready', 'passed') RETURNING id`,
      [content.id, master.id, artifactId, policy.id]
    );
    assert.ok(packageRow.rows[0].id, 'validated delivery package must be created');

    // A second creative revision gets its own node namespace.
    const revision2 = (await db.query(
      `INSERT INTO content_revisions(content_unit_id, revision_no, revision_type, parent_revision_id)
       VALUES ($1, 2, 'human_revision', $2) RETURNING id`,
      [content.id, revision.id]
    )).rows[0];
    await assert.rejects(
      db.query(
        `INSERT INTO production_nodes(content_revision_id, node_key, node_type)
         VALUES ($1, 'master', 'canonical_master')`,
        [revision.id]
      ),
      /duplicate key|unique/i
    );
    await db.query(
      `INSERT INTO production_nodes(content_revision_id, node_key, node_type)
       VALUES ($1, 'master', 'canonical_master')`,
      [revision2.id]
    );

    const finding = await db.query(
      `INSERT INTO qa_findings(content_unit_id, content_revision_id, artifact_id, severity, code, message, repair_scope)
       VALUES ($1, $2, $3, 'error', 'VISUAL_INTEGRITY', 'invalid anatomy detected', '{"node":"master","mode":"targeted"}')
       RETURNING id, repair_scope`,
      [content.id, revision.id, artifactId]
    );
    assert.equal(finding.rows[0].repair_scope.mode, 'targeted');

    // The publication gate rejects an unready package.
    const badPackage = (await db.query(
      `INSERT INTO delivery_packages(content_unit_id, content_master_id, master_artifact_id, policy_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [content.id, master.id, artifactId, policy.id]
    ).catch(() => null));
    assert.equal(badPackage, null, 'duplicate package must be rejected');

    // Publication is independently idempotent/auditable.
    await db.query(
      `INSERT INTO publication_attempts(delivery_package_id, attempt_no, idempotency_key)
       VALUES ($1, 1, 'cert-publication-1')`,
      [packageRow.rows[0].id]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO publication_attempts(delivery_package_id, attempt_no, idempotency_key)
         VALUES ($1, 2, 'cert-publication-1')`,
        [packageRow.rows[0].id]
      ),
      /duplicate key|unique/i
    );

    console.log('V2.1 autonomous production contract certification: PASS');
  } finally {
    for (const table of [
      'publication_attempts', 'delivery_packages', 'content_masters', 'human_reviews',
      'qa_findings', 'production_rules', 'artifact_lineage', 'production_edges',
      'production_nodes', 'content_units', 'content_revisions', 'delivery_policies',
      'delivery_adapters', 'artifact_provenance', 'artifacts', 'job_stages',
      'pipeline_runs', 'ai_models', 'ai_providers', 'workspaces',
    ]) {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
