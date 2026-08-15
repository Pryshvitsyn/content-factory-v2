'use strict';

const { resolveContext } = require('./v2.1-context-resolver');

const ACTIVE_STATUS = new Set(['ACTIVE']);

function assertUuid(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required`);
}

function parseConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config;
}

function ref(row, version = 1) {
  return { id: row.id, version, name: row.name };
}

function layer(row, fields = {}, version = 1) {
  return { ...ref(row, version), ...fields };
}

function requireActive(row, type) {
  if (!row) throw new Error(`${type} was not found`);
  if (!ACTIVE_STATUS.has(row.status)) throw new Error(`${type} ${row.id} is not ACTIVE`);
}

async function loadProductionContext({ client, projectId, tenantId, businessId, manageTransaction = true } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  assertUuid(projectId, 'projectId');

  if (manageTransaction) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  }

  try {
    const projectResult = await client.query(
      `SELECT id, name, status, config, tenant_id, business_id, brand_id, series_id
       FROM v2_1.projects WHERE id = $1`,
      [projectId]
    );
    const project = projectResult.rows[0];
    if (!project) throw new Error(`Project ${projectId} was not found`);
    if (!ACTIVE_STATUS.has(project.status)) throw new Error(`Project ${project.id} is not ACTIVE`);

    if (tenantId && project.tenant_id !== tenantId) {
      throw new Error(`Project ${project.id} does not belong to tenant ${tenantId}`);
    }
    if (businessId && project.business_id !== businessId) {
      throw new Error(`Project ${project.id} does not belong to business ${businessId}`);
    }
    if (!project.tenant_id || !project.business_id || !project.brand_id) {
      throw new Error('Project must have tenant_id, business_id and brand_id before production context can be resolved');
    }
    if (!project.series_id) throw new Error('Project must have series_id before production context can be resolved');

    const config = parseConfig(project.config);
    const audienceId = config.audienceId || config.audience_id || null;
    const offeringId = config.offeringId || config.offering_id || null;
    const strategyId = config.strategyId || config.strategy_id || null;

    // A single pg Client cannot execute concurrent queries. Keep these reads sequential
    // so the repeatable-read transaction remains valid and pg@9-safe.
    const tenantResult = await client.query(
      `SELECT id, name, status, metadata FROM v2_1.tenants WHERE id = $1`,
      [project.tenant_id]
    );
    const businessResult = await client.query(
      `SELECT id, tenant_id, name, industry, status, rules FROM v2_1.businesses WHERE id = $1`,
      [project.business_id]
    );
    const brandResult = await client.query(
      `SELECT id, business_id, name, voice, visual_identity, rules, compliance_rules, status FROM v2_1.brands WHERE id = $1`,
      [project.brand_id]
    );
    const seriesResult = await client.query(
      `SELECT id, universe_id, name, format_rules, narrative_rules, status FROM v2_1.series WHERE id = $1`,
      [project.series_id]
    );

    const tenant = tenantResult.rows[0];
    const business = businessResult.rows[0];
    const brand = brandResult.rows[0];
    const series = seriesResult.rows[0];

    requireActive(tenant, 'Tenant');
    requireActive(business, 'Business');
    requireActive(brand, 'Brand');
    requireActive(series, 'Series');

    if (business.tenant_id !== tenant.id) throw new Error('Business is owned by a different tenant');
    if (brand.business_id !== business.id) throw new Error('Brand is owned by a different business');

    const universeResult = await client.query(
      `SELECT id, brand_id, name, premise, rules FROM v2_1.content_universes WHERE id = $1`,
      [series.universe_id]
    );
    const universe = universeResult.rows[0];
    if (!universe) throw new Error(`Universe ${series.universe_id} was not found`);
    if (universe.brand_id !== brand.id) throw new Error('Universe is owned by a different brand');

    const optional = {};

    if (audienceId) {
      const result = await client.query(
        `SELECT id, business_id, brand_id, name, profile FROM v2_1.audiences WHERE id = $1`,
        [audienceId]
      );
      const audience = result.rows[0];
      if (!audience) throw new Error(`Audience ${audienceId} was not found`);
      if (audience.business_id !== business.id) throw new Error('Audience is owned by a different business');
      if (audience.brand_id && audience.brand_id !== brand.id) throw new Error('Audience is owned by a different brand');
      optional.audience = layer(audience, { profile: audience.profile });
    }

    if (offeringId) {
      const result = await client.query(
        `SELECT id, business_id, brand_id, offering_type, name, description, claims, metadata
         FROM v2_1.offerings WHERE id = $1`,
        [offeringId]
      );
      const offering = result.rows[0];
      if (!offering) throw new Error(`Offering ${offeringId} was not found`);
      if (offering.business_id !== business.id) throw new Error('Offering is owned by a different business');
      if (offering.brand_id && offering.brand_id !== brand.id) throw new Error('Offering is owned by a different brand');
      optional.offering = layer(offering, {
        offeringType: offering.offering_type,
        description: offering.description,
        claims: offering.claims,
        metadata: offering.metadata,
      });
    }

    if (strategyId) {
      const result = await client.query(
        `SELECT id, brand_id, version, objective, pillars, platform_rules, trend_rules, learning_policy, status
         FROM v2_1.content_strategies WHERE id = $1`,
        [strategyId]
      );
      const strategy = result.rows[0];
      if (!strategy) throw new Error(`Strategy ${strategyId} was not found`);
      if (strategy.brand_id !== brand.id) throw new Error('Strategy belongs to a different brand');
      if (strategy.status !== 'ACTIVE') throw new Error(`Strategy ${strategy.id} is not ACTIVE`);
      optional.strategy = layer(strategy, {
        objective: strategy.objective,
        pillars: strategy.pillars,
        platformRules: strategy.platform_rules,
        trendRules: strategy.trend_rules,
        learningPolicy: strategy.learning_policy,
      }, strategy.version);
    }

    const contextInput = {
      tenant: layer(tenant, { metadata: tenant.metadata }),
      business: layer(business, { industry: business.industry, rules: business.rules }),
      brand: layer(brand, {
        voice: brand.voice,
        visualIdentity: brand.visual_identity,
        rules: brand.rules,
        complianceRules: brand.compliance_rules,
      }),
      universe: layer(universe, { premise: universe.premise, rules: universe.rules }),
      series: layer(series, {
        formatRules: series.format_rules,
        narrativeRules: series.narrative_rules,
      }),
      ...optional,
    };

    const resolved = resolveContext(contextInput);
    const result = Object.freeze({
      project: Object.freeze({ id: project.id, name: project.name }),
      context: resolved,
    });

    if (manageTransaction) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (manageTransaction) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    throw error;
  }
}

module.exports = { loadProductionContext };
