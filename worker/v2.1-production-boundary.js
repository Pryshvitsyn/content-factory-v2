'use strict';

const crypto = require('crypto');
const { loadProductionContext } = require('./v2.1-db-context-loader');
const { STAGE_DEFINITIONS } = require('./v2.1-production-contract');
const { canonicalJson } = require('./v2.1-context-resolver');

const STAGES = Object.freeze(Object.keys(STAGE_DEFINITIONS));

function hash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function assertUuid(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required`);
}

/**
 * Creates exactly one executable production for a normalized request + resolved context.
 * All writes happen in one transaction; PostgreSQL owns the final idempotency and
 * ownership guarantees through the production-boundary migration.
 */
async function createProduction({
  client,
  projectId,
  contentVariantId,
  tenantId,
  businessId,
  request,
  platforms = [],
} = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  assertUuid(projectId, 'projectId');
  assertUuid(contentVariantId, 'contentVariantId');
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('request must be an object');

  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

  try {
    const ownership = await client.query(
      `SELECT cv.id AS variant_id, c.id AS content_id, c.project_id
       FROM v2_1.content_variants cv
       JOIN v2_1.contents c ON c.id = cv.content_id
       WHERE cv.id = $1 AND c.project_id = $2`,
      [contentVariantId, projectId]
    );
    if (ownership.rowCount !== 1) throw new Error('Content variant does not belong to the requested project');

    const contextResult = await loadProductionContext({
      client,
      projectId,
      tenantId,
      businessId,
      manageTransaction: false,
    });

    const context = contextResult.context;
    const normalizedRequest = {
      projectId,
      contentVariantId,
      platforms: [...new Set(platforms)].sort(),
      request,
    };
    const requestHash = hash({ request: normalizedRequest, contextFingerprint: context.fingerprint });

    const requestInsert = await client.query(
      `INSERT INTO v2_1.production_requests
         (tenant_id, business_id, project_id, request_hash, request)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, request_hash) DO NOTHING
       RETURNING id`,
      [
        context.references.tenant.id,
        context.references.business.id,
        projectId,
        requestHash,
        JSON.stringify(normalizedRequest),
      ]
    );

    if (requestInsert.rowCount === 0) {
      const existing = await client.query(
        `SELECT p.id, p.status, p.context_fingerprint
         FROM v2_1.production_requests r
         JOIN v2_1.productions p ON p.id = r.production_id
         WHERE r.tenant_id = $1 AND r.request_hash = $2`,
        [context.references.tenant.id, requestHash]
      );
      if (existing.rowCount !== 1) throw new Error('Idempotency record exists without a production');
      await client.query('COMMIT');
      return { ...existing.rows[0], idempotent: true };
    }

    const production = await client.query(
      `INSERT INTO v2_1.productions
         (content_variant_id, production_version, status,
          tenant_id, business_id, brand_id, project_id,
          request_hash, context_fingerprint, context_version,
          context_snapshot, request_snapshot, metadata)
       VALUES ($1, 1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
       RETURNING id, status, context_fingerprint`,
      [
        contentVariantId,
        context.references.tenant.id,
        context.references.business.id,
        context.references.brand.id,
        projectId,
        requestHash,
        context.fingerprint,
        context.resolverVersion,
        JSON.stringify(context),
        JSON.stringify(normalizedRequest),
        JSON.stringify({ platforms: normalizedRequest.platforms }),
      ]
    );

    const productionId = production.rows[0].id;

    await client.query(
      `UPDATE v2_1.production_requests
       SET production_id = $1
       WHERE id = $2`,
      [productionId, requestInsert.rows[0].id]
    );

    const job = await client.query(
      `INSERT INTO v2_1.jobs
         (production_id, job_type, status, idempotency_key, input)
       VALUES ($1, 'PRODUCTION', 'QUEUED', $2, $3::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, status, idempotency_key`,
      [productionId, `production:${requestHash}`, JSON.stringify({ productionId, contextFingerprint: context.fingerprint })]
    );

    if (job.rowCount !== 1) throw new Error('Production job idempotency collision');

    const stageIds = [];
    for (const stage of STAGES) {
      const result = await client.query(
        `INSERT INTO v2_1.stage_runs (job_id, stage, attempt, status)
         VALUES ($1, $2, 1, 'QUEUED')
         RETURNING id`,
        [job.rows[0].id, stage]
      );
      stageIds.push(result.rows[0].id);
    }

    await client.query('COMMIT');
    return {
      id: productionId,
      status: production.rows[0].status,
      contextFingerprint: production.rows[0].context_fingerprint,
      requestHash,
      jobId: job.rows[0].id,
      stageRunIds: stageIds,
      idempotent: false,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = { createProduction, hash, STAGES };
