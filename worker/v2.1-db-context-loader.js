const { Pool } = require('pg');

/**
 * V2.1 Database Context Loader
 * 
 * Loads complete production context from database:
 * - Business
 * - Brand
 * - Brand identity
 * - Brand rules
 * - Content universe (series)
 * - Production
 * - Characters, locations, styles, voices, props
 * - Audiences, products
 * - Compliance policies
 * 
 * This provides the raw data for context resolution.
 */
class DbContextLoader {
  /**
   * Load complete production context from database
   * @param {Pool} db - Database pool
   * @param {string} productionId - Production UUID
   * @returns {Promise<Object|null>} Context object or null
   */
  static async loadProductionContext(db, productionId) {
    // Load production with content variant and universe
    const productionResult = await db.query(
      `SELECT 
        p.id as production_id,
        p.title,
        p.content_variant_id,
        p.universe_id,
        cv.hook,
        cv.angle,
        cv.cta,
        cv.target_platform,
        c.title as content_title,
        c.objective,
        c.audience,
        c.topic,
        b.id as business_id,
        b.name as business_name,
        b.industry,
        b.settings as business_settings,
        br.id as brand_id,
        br.name as brand_name,
        br.tagline,
        br.settings as brand_settings,
        cu.id as universe_id,
        cu.name as universe_name,
        cu.type as universe_type,
        cu.format_rules as universe_format_rules,
        cu.recurring_elements
      FROM productions p
      JOIN content_variants cv ON p.content_variant_id = cv.id
      JOIN contents c ON cv.content_id = c.id
      JOIN businesses b ON c.business_id = b.id
      JOIN brands br ON cv.brand_id = br.id
      LEFT JOIN content_universes cu ON p.universe_id = cu.id
      WHERE p.id = $1`,
      [productionId]
    );
    
    if (productionResult.rows.length === 0) {
      return null;
    }
    
    const production = productionResult.rows[0];
    
    // Load brand identity
    const identityResult = await db.query(
      `SELECT * FROM brand_identities 
       WHERE brand_id = $1 AND is_active = true 
       ORDER BY version DESC LIMIT 1`,
      [production.brand_id]
    );
    
    const brandIdentity = identityResult.rows[0] || null;
    
    // Load brand rules
    const rulesResult = await db.query(
      `SELECT * FROM brand_rules 
       WHERE brand_id = $1 AND is_active = true`,
      [production.brand_id]
    );
    
    const brandRules = rulesResult.rows || [];
    
    // Load audience
    const audienceResult = await db.query(
      `SELECT a.* FROM audiences a
       JOIN brand_audiences ba ON a.id = ba.audience_id
       WHERE ba.brand_id = $1 AND a.is_active = true`,
      [production.brand_id]
    );
    
    const audiences = audienceResult.rows || [];
    
    // Load products
    const productsResult = await db.query(
      `SELECT p.* FROM products p
       JOIN brand_products bp ON p.id = bp.product_id
       WHERE bp.brand_id = $1 AND p.is_active = true`,
      [production.brand_id]
    );
    
    const products = productsResult.rows || [];
    
    // Load compliance policies
    const complianceResult = await db.query(
      `SELECT ip.* FROM industry_policies ip
       JOIN business_compliance bc ON ip.id = bc.policy_id
       WHERE bc.business_id = $1 AND bc.status = 'active'`,
      [production.business_id]
    );
    
    const compliancePolicies = complianceResult.rows || [];
    
    // Load characters from universe
    const charactersResult = await db.query(
      `SELECT c.* FROM characters c
       JOIN universe_characters uc ON c.id = uc.character_id
       WHERE uc.universe_id = $1`,
      [production.universe_id]
    );
    
    const characters = charactersResult.rows || [];
    
    return {
      production: {
        id: production.production_id,
        title: production.title,
        content_variant_id: production.content_variant_id,
        universe_id: production.universe_id,
        hook: production.hook,
        angle: production.angle,
        cta: production.cta,
        target_platform: production.target_platform
      },
      content: {
        id: production.content_variant_id,
        title: production.content_title,
        objective: production.objective,
        audience: production.audience,
        topic: production.topic
      },
      business: {
        id: production.business_id,
        name: production.business_name,
        industry: production.industry,
        settings: production.business_settings,
        compliance_policies: compliancePolicies
      },
      brand: {
        id: production.brand_id,
        name: production.brand_name,
        tagline: production.tagline,
        settings: production.brand_settings,
        identity: brandIdentity,
        rules: brandRules
      },
      universe: production.universe_id ? {
        id: production.universe_id,
        name: production.universe_name,
        type: production.universe_type,
        format_rules: production.universe_format_rules,
        recurring_elements: production.recurring_elements,
        characters: characters
      } : null,
      audiences: audiences,
      products: products
    };
  }

  /**
   * Load business context
   * @param {Pool} db - Database pool
   * @param {string} businessId - Business UUID
   * @returns {Promise<Object|null>}
   */
  static async loadBusinessContext(db, businessId) {
    const result = await db.query(
      `SELECT * FROM businesses WHERE id = $1`,
      [businessId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const business = result.rows[0];
    
    // Load compliance policies
    const complianceResult = await db.query(
      `SELECT ip.* FROM industry_policies ip
       JOIN business_compliance bc ON ip.id = bc.policy_id
       WHERE bc.business_id = $1 AND bc.status = 'active'`,
      [businessId]
    );
    
    return {
      ...business,
      compliance_policies: complianceResult.rows || []
    };
  }

  /**
   * Load brand context
   * @param {Pool} db - Database pool
   * @param {string} brandId - Brand UUID
   * @returns {Promise<Object|null>}
   */
  static async loadBrandContext(db, brandId) {
    const result = await db.query(
      `SELECT * FROM brands WHERE id = $1`,
      [brandId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const brand = result.rows[0];
    
    // Load brand identity
    const identityResult = await db.query(
      `SELECT * FROM brand_identities 
       WHERE brand_id = $1 AND is_active = true 
       ORDER BY version DESC LIMIT 1`,
      [brandId]
    );
    
    const identity = identityResult.rows[0] || null;
    
    // Load brand rules
    const rulesResult = await db.query(
      `SELECT * FROM brand_rules 
       WHERE brand_id = $1 AND is_active = true`,
      [brandId]
    );
    
    const rules = rulesResult.rows || [];
    
    return {
      ...brand,
      identity,
      rules
    };
  }
}

module.exports = { DbContextLoader };
