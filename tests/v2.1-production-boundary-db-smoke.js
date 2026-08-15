'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { createProduction, STAGES } = require('../worker/v2.1-production-boundary');

const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
});

const q = (text, values = []) => client.query(text, values);
const json = (value) => JSON.stringify(value);

async function cleanup(ids) {
  try { await q('ROLLBACK'); } catch {}
  try {
    if (ids.production) {
      await q(`DELETE FROM v2_1.production_requests WHERE production_id = $1`, [ids.production]);
      await q(`DELETE FROM v2_1.events WHERE entity_type = 'production' AND entity_id = $1`, [ids.production]);
      await q(`DELETE FROM v2_1.productions WHERE id = $1`, [ids.production]);
    }
    if (ids.tenant) await q(`DELETE FROM v2_1.tenants WHERE id = $1`, [ids.tenant]);
  } catch (error) {
    console.error('Cleanup warning:', error.message);
  }
}

async function main() {
  await client.connect();
  const suffix = Date.now().toString();
  const ids = {};

  try {
    await q('BEGIN');

    const tenant = await q(
      `INSERT INTO v2_1.tenants (name, metadata) VALUES ($1, $2::jsonb) RETURNING id`,
      [`Boundary Tenant ${suffix}`, json({ test: true })]
    );
    ids.tenant = tenant.rows[0].id;

    const business = await q(
      `INSERT INTO v2_1.businesses (tenant_id, name, industry, rules)
       VALUES ($1, $2, 'MEDIA', $3::jsonb) RETURNING id`,
      [ids.tenant, `Boundary Business ${suffix}`, json({ businessRule: 'business' })]
    );
    ids.business = business.rows[0].id;

    const brand = await q(
      `INSERT INTO v2_1.brands (business_id, name, voice, visual_identity, rules, compliance_rules)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
      [ids.business, `Boundary Brand ${suffix}`, json({ tone: 'direct' }), json({ style: 'clean' }), json({ brandRule: 'brand' }), json({})]
    );
    ids.brand = brand.rows[0].id;

    const audience = await q(
      `INSERT INTO v2_1.audiences (business_id, brand_id, name, profile)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [ids.business, ids.brand, `Boundary Audience ${suffix}`, json({ intent: 'buy' })]
    );
    ids.audience = audience.rows[0].id;

    const offering = await q(
      `INSERT INTO v2_1.offerings (business_id, brand_id, offering_type, name, claims)
       VALUES ($1, $2, 'SERVICE', $3, $4::jsonb) RETURNING id`,
      [ids.business, ids.brand, `Boundary Offering ${suffix}`, json(['true claim'])]
    );
    ids.offering = offering.rows[0].id;

    const strategy = await q(
      `INSERT INTO v2_1.content_strategies
       (brand_id, version, objective, pillars, platform_rules, trend_rules, learning_policy)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
      [ids.brand, json({ primary: 'conversion' }), json(['education']), json({}), json({}), json({})]
    );
    ids.strategy = strategy.rows[0].id;

    const universe = await q(
      `INSERT INTO v2_1.content_universes (brand_id, name, premise, rules)
       VALUES ($1, $2, 'Boundary premise', $3::jsonb) RETURNING id`,
      [ids.brand, `Boundary Universe ${suffix}`, json({})]
    );
    ids.universe = universe.rows[0].id;

    const series = await q(
      `INSERT INTO v2_1.series (universe_id, name, format_rules, narrative_rules)
       VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
      [ids.universe, `Boundary Series ${suffix}`, json({}), json({})]
    );
    ids.series = series.rows[0].id;

    const project = await q(
      `INSERT INTO v2_1.projects
       (name, status, config, tenant_id, business_id, brand_id, series_id)
       VALUES ($1, 'ACTIVE', $2::jsonb, $3, $4, $5, $6) RETURNING id`,
      [
        `Boundary Project ${suffix}`,
        json({ audienceId: ids.audience, offeringId: ids.offering, strategyId: ids.strategy }),
        ids.tenant, ids.business, ids.brand, ids.series,
      ]
    );
    ids.project = project.rows[0].id;

    const content = await q(
      `INSERT INTO v2_1.contents (project_id, title, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [ids.project, `Boundary Content ${suffix}`]
    );
    ids.content = content.rows[0].id;

    const variant = await q(
      `INSERT INTO v2_1.content_variants (content_id, name, target_platform, status)
       VALUES ($1, $2, 'TIKTOK', 'READY') RETURNING id`,
      [ids.content, `Boundary Variant ${suffix}`]
    );
    ids.variant = variant.rows[0].id;

    await q('COMMIT');

    const first = await createProduction({
      client,
      projectId: ids.project,
      contentVariantId: ids.variant,
      tenantId: ids.tenant,
      businessId: ids.business,
      platforms: ['TIKTOK', 'INSTAGRAM_REELS', 'TIKTOK'],
      request: { idea: 'boundary smoke', seed: 'A' },
    });
    ids.production = first.id;

    if (first.idempotent) throw new Error('First production must not be idempotent');
    if (first.stageRunIds.length !== STAGES.length) throw new Error('All production stages were not created');

    const second = await createProduction({
      client,
      projectId: ids.project,
      contentVariantId: ids.variant,
      tenantId: ids.tenant,
      businessId: ids.business,
      platforms: ['INSTAGRAM_REELS', 'TIKTOK'],
      request: { seed: 'A', idea: 'boundary smoke' },
    });

    if (!second.idempotent || second.id !== first.id) throw new Error('Duplicate production was not collapsed by idempotency');

    const counts = await q(
      `SELECT
        (SELECT count(*) FROM v2_1.production_requests WHERE production_id = $1) AS requests,
        (SELECT count(*) FROM v2_1.jobs WHERE production_id = $1) AS jobs,
        (SELECT count(*) FROM v2_1.stage_runs WHERE job_id = $2) AS stages,
        (SELECT count(*) FROM v2_1.events WHERE entity_type = 'production' AND entity_id = $1 AND event_type = 'PRODUCTION_CREATED') AS audit_events`,
      [first.id, first.jobId]
    );

    const row = counts.rows[0];
    if (row.requests !== '1' || row.jobs !== '1' || row.stages !== String(STAGES.length) || row.audit_events !== '1') {
      throw new Error(`Boundary counts invalid: ${JSON.stringify(row)}`);
    }

    await q(`UPDATE v2_1.productions SET status = 'RUNNING', started_at = now() WHERE id = $1`, [first.id]);

    let immutableRejected = false;
    try {
      await q(`UPDATE v2_1.productions SET context_snapshot = jsonb_build_object('tampered', true) WHERE id = $1`, [first.id]);
    } catch (error) {
      immutableRejected = /immutable|snapshot|context/i.test(error.message);
    }
    if (!immutableRejected) throw new Error('Database did not reject context snapshot mutation');

    let ownershipRejected = false;
    await q(`INSERT INTO v2_1.businesses (tenant_id, name, industry) VALUES ($1, $2, 'OTHER') RETURNING id`, [ids.tenant, `Other Business ${suffix}`])
      .then((result) => { ids.otherBusiness = result.rows[0].id; });
    await q(
      `INSERT INTO v2_1.brands (business_id, name) VALUES ($1, $2) RETURNING id`,
      [ids.otherBusiness, `Other Brand ${suffix}`]
    ).then((result) => { ids.otherBrand = result.rows[0].id; });
    try {
      await q(`UPDATE v2_1.productions SET brand_id = $1 WHERE id = $2`, [ids.otherBrand, first.id]);
    } catch (error) {
      ownershipRejected = /ownership|business|immutable|context/i.test(error.message);
    }
    if (!ownershipRejected) throw new Error('Database did not reject cross-business production ownership');

    await cleanup(ids);
    console.log('V2.1 PRODUCTION BOUNDARY DATABASE SMOKE TEST PASSED.');
    console.log('IDEMPOTENCY ENFORCED.');
    console.log('CONTEXT SNAPSHOT IMMUTABILITY ENFORCED.');
    console.log('OWNERSHIP BOUNDARY ENFORCED.');
    console.log('AUDIT EVENT RECORDED.');
    console.log('JOB + ALL STAGE RUNS CREATED TRANSACTIONALLY.');
    console.log('TEST DATA CLEANED UP.');
  } catch (error) {
    await cleanup(ids);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 PRODUCTION BOUNDARY DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
