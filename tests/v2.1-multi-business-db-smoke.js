const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
});

const q = (text, values = []) => client.query(text, values);

async function main() {
  await client.connect();

  const suffix = Date.now().toString();

  try {
    await q('BEGIN');

    // ------------------------------------------------------------
    // TENANT
    // ------------------------------------------------------------

    const tenant = await q(
      `INSERT INTO v2_1.tenants (name)
       VALUES ($1)
       RETURNING id`,
      [`V2.1 Test Tenant ${suffix}`]
    );

    const tenantId = tenant.rows[0].id;

    // ------------------------------------------------------------
    // TWO BUSINESSES UNDER ONE TENANT
    // ------------------------------------------------------------

    const businessA = await q(
      `INSERT INTO v2_1.businesses (tenant_id, name, industry)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, `Business A ${suffix}`, 'RETAIL']
    );

    const businessB = await q(
      `INSERT INTO v2_1.businesses (tenant_id, name, industry)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, `Business B ${suffix}`, 'SERVICES']
    );

    const businessAId = businessA.rows[0].id;
    const businessBId = businessB.rows[0].id;

    // ------------------------------------------------------------
    // ONE BRAND PER BUSINESS
    // ------------------------------------------------------------

    const brandA = await q(
      `INSERT INTO v2_1.brands (business_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [businessAId, `Brand A ${suffix}`]
    );

    const brandB = await q(
      `INSERT INTO v2_1.brands (business_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [businessBId, `Brand B ${suffix}`]
    );

    const brandAId = brandA.rows[0].id;
    const brandBId = brandB.rows[0].id;

    // ------------------------------------------------------------
    // ONE CONTENT UNIVERSE PER BRAND
    // ------------------------------------------------------------

    const universeA = await q(
      `INSERT INTO v2_1.content_universes
        (brand_id, name, premise)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        brandAId,
        `Universe A ${suffix}`,
        'Creative universe for Business A',
      ]
    );

    const universeB = await q(
      `INSERT INTO v2_1.content_universes
        (brand_id, name, premise)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        brandBId,
        `Universe B ${suffix}`,
        'Creative universe for Business B',
      ]
    );

    const universeAId = universeA.rows[0].id;
    const universeBId = universeB.rows[0].id;

    // ------------------------------------------------------------
    // ONE SERIES PER UNIVERSE
    // ------------------------------------------------------------

    const seriesA = await q(
      `INSERT INTO v2_1.series
        (universe_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [universeAId, `Series A ${suffix}`]
    );

    const seriesB = await q(
      `INSERT INTO v2_1.series
        (universe_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [universeBId, `Series B ${suffix}`]
    );

    const seriesAId = seriesA.rows[0].id;
    const seriesBId = seriesB.rows[0].id;

    // ------------------------------------------------------------
    // VERIFY THE COMPLETE OWNERSHIP CHAIN
    //
    // TENANT
    //   → BUSINESS
    //      → BRAND
    //         → UNIVERSE
    //            → SERIES
    // ------------------------------------------------------------

    const hierarchy = await q(
      `SELECT
         b.id AS business_id,
         b.tenant_id,

         br.id AS brand_id,
         br.business_id AS brand_business_id,

         u.id AS universe_id,
         u.brand_id AS universe_brand_id,

         s.id AS series_id,
         s.universe_id AS series_universe_id

       FROM v2_1.businesses b

       JOIN v2_1.brands br
         ON br.business_id = b.id

       JOIN v2_1.content_universes u
         ON u.brand_id = br.id

       JOIN v2_1.series s
         ON s.universe_id = u.id

       WHERE b.id = $1
         AND s.id = $2`,
      [businessAId, seriesAId]
    );

    if (hierarchy.rowCount !== 1) {
      throw new Error(
        `Expected one complete Business A hierarchy, got ${hierarchy.rowCount}`
      );
    }

    const row = hierarchy.rows[0];

    if (
      row.business_id !== businessAId ||
      row.tenant_id !== tenantId ||
      row.brand_id !== brandAId ||
      row.brand_business_id !== businessAId ||
      row.universe_id !== universeAId ||
      row.universe_brand_id !== brandAId ||
      row.series_id !== seriesAId ||
      row.series_universe_id !== universeAId
    ) {
      throw new Error('Business A ownership chain is invalid');
    }

    // ------------------------------------------------------------
    // VERIFY BUSINESS B IS A SEPARATE CREATIVE CONTEXT
    // ------------------------------------------------------------

    const isolation = await q(
      `SELECT
         a.id AS business_a,
         b.id AS business_b,
         ba.business_id AS brand_a_business,
         bb.business_id AS brand_b_business,
         ua.brand_id AS universe_a_brand,
         ub.brand_id AS universe_b_brand,
         sa.universe_id AS series_a_universe,
         sb.universe_id AS series_b_universe

       FROM v2_1.businesses a
       JOIN v2_1.businesses b
         ON b.id = $2

       JOIN v2_1.brands ba
         ON ba.id = $3

       JOIN v2_1.brands bb
         ON bb.id = $4

       JOIN v2_1.content_universes ua
         ON ua.id = $5

       JOIN v2_1.content_universes ub
         ON ub.id = $6

       JOIN v2_1.series sa
         ON sa.id = $7

       JOIN v2_1.series sb
         ON sb.id = $8

       WHERE a.id = $1
         AND a.id <> b.id`,
      [
        businessAId,
        businessBId,
        brandAId,
        brandBId,
        universeAId,
        universeBId,
        seriesAId,
        seriesBId,
      ]
    );

    if (isolation.rowCount !== 1) {
      throw new Error(
        `Expected one business isolation result, got ${isolation.rowCount}`
      );
    }

    const isolated = isolation.rows[0];

    if (
      isolated.business_a !== businessAId ||
      isolated.business_b !== businessBId ||
      isolated.brand_a_business !== businessAId ||
      isolated.brand_b_business !== businessBId ||
      isolated.universe_a_brand !== brandAId ||
      isolated.universe_b_brand !== brandBId ||
      isolated.series_a_universe !== universeAId ||
      isolated.series_b_universe !== universeBId
    ) {
      throw new Error(
        'Business isolation or ownership chain verification failed'
      );
    }

    // ------------------------------------------------------------
    // VERIFY CROSS-BUSINESS BRAND MIXING IS IMPOSSIBLE
    // ------------------------------------------------------------

    const crossBusiness = await q(
      `SELECT COUNT(*)::int AS count
       FROM v2_1.brands
       WHERE id = $1
         AND business_id <> $2`,
      [brandAId, businessBId]
    );

    if (crossBusiness.rows[0].count !== 1) {
      throw new Error(
        'Expected Brand A to remain owned by Business A'
      );
    }

    // ------------------------------------------------------------
    // ROLLBACK TEST DATA
    // ------------------------------------------------------------

    await q('ROLLBACK');

    // ------------------------------------------------------------
    // VERIFY ROLLBACK
    // ------------------------------------------------------------

    const cleanup = await q(
      `SELECT COUNT(*)::int AS count
       FROM v2_1.tenants
       WHERE id = $1`,
      [tenantId]
    );

    if (cleanup.rows[0].count !== 0) {
      throw new Error('Test tenant was not rolled back');
    }

    console.log('V2.1 MULTI-BUSINESS DATABASE SMOKE TEST PASSED.');
    console.log('TENANT -> BUSINESS -> BRAND -> UNIVERSE -> SERIES');
    console.log('BUSINESS A and BUSINESS B remained isolated.');
    console.log('CROSS-BUSINESS OWNERSHIP VERIFIED.');
    console.log('TEST DATA ROLLED BACK.');
  } catch (error) {
    try {
      await q('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 MULTI-BUSINESS DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
