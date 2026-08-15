'use strict';

const { Client } = require('pg');
require('dotenv').config();
const { loadProductionContext } = require('../worker/v2.1-db-context-loader');

const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
});

const q = (text, values = []) => client.query(text, values);

async function insertFixture(suffix, businessName, industry) {
  const tenant = await q(
    `INSERT INTO v2_1.tenants (name, metadata)
     VALUES ($1, $2) RETURNING id`,
    [`DB Context Tenant ${suffix}`, { test: true }]
  );
  const tenantId = tenant.rows[0].id;

  const business = await q(
    `INSERT INTO v2_1.businesses (tenant_id, name, industry, rules)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `${businessName} ${suffix}`, industry, { businessRule: 'keep' }]
  );
  const businessId = business.rows[0].id;

  const brand = await q(
    `INSERT INTO v2_1.brands
      (business_id, name, voice, visual_identity, rules, compliance_rules)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      businessId,
      `Brand ${businessName} ${suffix}`,
      { tone: 'confident' },
      { palette: 'canonical' },
      { brandRule: 'brand-wins' },
      { claims: 'must-be-true' },
    ]
  );
  const brandId = brand.rows[0].id;

  const audience = await q(
    `INSERT INTO v2_1.audiences (business_id, brand_id, name, profile)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [businessId, brandId, `Audience ${suffix}`, { age: '25-34', intent: 'buy' }]
  );
  const audienceId = audience.rows[0].id;

  const offering = await q(
    `INSERT INTO v2_1.offerings
      (business_id, brand_id, offering_type, name, description, claims)
     VALUES ($1, $2, 'PRODUCT', $3, $4, $5) RETURNING id`,
    [businessId, brandId, `Offering ${suffix}`, 'Canonical product', ['approved claim']]
  );
  const offeringId = offering.rows[0].id;

  const strategy = await q(
    `INSERT INTO v2_1.content_strategies
      (brand_id, version, objective, pillars, platform_rules, trend_rules, learning_policy)
     VALUES ($1, 1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      brandId,
      { primary: 'conversion' },
      ['education', 'proof'],
      { TIKTOK: { maxSeconds: 30 } },
      { freshnessWindowDays: 7 },
      { retainWinners: true },
    ]
  );
  const strategyId = strategy.rows[0].id;

  const universe = await q(
    `INSERT INTO v2_1.content_universes (brand_id, name, premise, rules)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [brandId, `Universe ${suffix}`, 'A stable creative world', { universeRule: 'consistent' }]
  );
  const universeId = universe.rows[0].id;

  const series = await q(
    `INSERT INTO v2_1.series (universe_id, name, format_rules, narrative_rules)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [universeId, `Series ${suffix}`, { recurring: true }, { arc: 'episodic' }]
  );
  const seriesId = series.rows[0].id;

  const project = await q(
    `INSERT INTO v2_1.projects
      (name, tenant_id, business_id, brand_id, series_id, config)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      `Production Project ${suffix}`,
      tenantId,
      businessId,
      brandId,
      seriesId,
      { audienceId, offeringId, strategyId },
    ]
  );

  return { tenantId, businessId, brandId, audienceId, offeringId, strategyId, universeId, seriesId, projectId: project.rows[0].id };
}

async function main() {
  await client.connect();
  const suffix = Date.now().toString();

  try {
    await q('BEGIN');

    const fixture = await insertFixture(suffix, 'Business A', 'RETAIL');
    const loadArgs = {
      client,
      projectId: fixture.projectId,
      tenantId: fixture.tenantId,
      businessId: fixture.businessId,
      manageTransaction: false,
    };

    const loaded = await loadProductionContext(loadArgs);
    const refs = loaded.context.references;

    for (const [key, expected] of Object.entries({
      tenant: fixture.tenantId,
      business: fixture.businessId,
      brand: fixture.brandId,
      audience: fixture.audienceId,
      offering: fixture.offeringId,
      strategy: fixture.strategyId,
      universe: fixture.universeId,
      series: fixture.seriesId,
    })) {
      if (refs[key].id !== expected) throw new Error(`${key} resolution failed`);
    }

    if (loaded.context.effective.brandRule !== 'brand-wins') throw new Error('Brand rules were not resolved');
    if (loaded.context.effective.objective.primary !== 'conversion') throw new Error('Strategy objective was not resolved');
    if (loaded.context.effective.profile.intent !== 'buy') throw new Error('Audience profile was not resolved');

    const wrongBusiness = await q(
      `INSERT INTO v2_1.businesses (tenant_id, name, industry)
       VALUES ($1, $2, 'OTHER') RETURNING id`,
      [fixture.tenantId, `Wrong Business ${suffix}`]
    );

    let rejected = false;
    try {
      await loadProductionContext({
        client,
        projectId: fixture.projectId,
        tenantId: fixture.tenantId,
        businessId: wrongBusiness.rows[0].id,
        manageTransaction: false,
      });
    } catch (error) {
      rejected = /does not belong to business/.test(error.message);
    }
    if (!rejected) throw new Error('Cross-business project access was not rejected');

    const loadedAgain = await loadProductionContext(loadArgs);
    if (loadedAgain.context.fingerprint !== loaded.context.fingerprint) {
      throw new Error('Identical database context produced different fingerprints');
    }

    await q('ROLLBACK');

    console.log('V2.1 PRODUCTION CONTEXT DATABASE SMOKE TEST PASSED.');
    console.log('POSTGRES -> TENANT -> BUSINESS -> BRAND -> AUDIENCE/OFFERING/STRATEGY -> UNIVERSE -> SERIES -> PROJECT');
    console.log('OWNERSHIP BOUNDARIES VERIFIED.');
    console.log('DETERMINISTIC CONTEXT FINGERPRINT VERIFIED.');
    console.log('CROSS-BUSINESS ACCESS REJECTED.');
    console.log('TEST DATA ROLLED BACK.');
  } catch (error) {
    try { await q('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 PRODUCTION CONTEXT DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
