/**
 * V2.1 Context Resolver
 * 
 * Resolves inheritance hierarchy:
 * Business Rules → Brand Rules → Series Rules → Production Rules
 * 
 * Takes raw context from DbContextLoader and produces resolved context
 * with all inheritance applied.
 */
class ContextResolver {
  /**
   * Resolve inheritance for production context
   * @param {Object} context - Raw context from DbContextLoader
   * @returns {Object} Resolved context
   */
  static resolve(context) {
    // Resolve business rules
    const businessRules = this.resolveBusinessRules(context.business);
    
    // Resolve brand rules (inherits from business)
    const brandRules = this.resolveBrandRules(context.brand, businessRules);
    
    // Resolve universe/series rules (inherits from brand)
    const universeRules = context.universe 
      ? this.resolveUniverseRules(context.universe, brandRules)
      : brandRules;
    
    // Resolve production rules (inherits from universe/brand)
    const productionRules = this.resolveProductionRules(context.production, universeRules);
    
    return {
      ...context,
      resolved_rules: {
        business: businessRules,
        brand: brandRules,
        universe: universeRules,
        production: productionRules
      }
    };
  }

  /**
   * Resolve business-level rules
   * @param {Object} business - Business context
   * @returns {Object} Resolved business rules
   */
  static resolveBusinessRules(business) {
    const rules = {
      industry: business.industry,
      compliance: [],
      settings: business.settings || {}
    };
    
    // Extract compliance policies
    if (business.compliance_policies) {
      business.compliance_policies.forEach(policy => {
        rules.compliance.push({
          policy_id: policy.id,
          industry: policy.industry,
          rules: policy.rules,
          severity: policy.severity,
          is_mandatory: policy.is_mandatory
        });
      });
    }
    
    return rules;
  }

  /**
   * Resolve brand-level rules (inherits from business)
   * @param {Object} brand - Brand context
   * @param {Object} businessRules - Resolved business rules
   * @returns {Object} Resolved brand rules
   */
  static resolveBrandRules(brand, businessRules) {
    const rules = {
      ...businessRules,
      tone: brand.identity?.tone || 'neutral',
      visual_language: brand.identity?.visual_language || {},
      color_palette: brand.identity?.color_palette || {},
      typography: brand.identity?.typography || {},
      brand_specific_rules: []
    };
    
    // Extract brand-specific rules
    if (brand.rules) {
      brand.rules.forEach(rule => {
        rules.brand_specific_rules.push({
          rule_type: rule.rule_type,
          category: rule.category,
          constraint_type: rule.constraint_type,
          constraint_value: rule.constraint_value,
          severity: rule.severity
        });
      });
    }
    
    return rules;
  }

  /**
   * Resolve universe/series rules (inherits from brand)
   * @param {Object} universe - Universe context
   * @param {Object} brandRules - Resolved brand rules
   * @returns {Object} Resolved universe rules
   */
  static resolveUniverseRules(universe, brandRules) {
    return {
      ...brandRules,
      universe_id: universe.id,
      universe_name: universe.name,
      universe_type: universe.type,
      format_rules: universe.format_rules || {},
      recurring_elements: universe.recurring_elements || {},
      characters: universe.characters || []
    };
  }

  /**
   * Resolve production-level rules (inherits from universe/brand)
   * @param {Object} production - Production context
   * @param {Object} universeRules - Resolved universe rules
   * @returns {Object} Resolved production rules
   */
  static resolveProductionRules(production, universeRules) {
    return {
      ...universeRules,
      production_id: production.id,
      production_title: production.title,
      hook: production.hook,
      angle: production.angle,
      cta: production.cta,
      target_platform: production.target_platform
    };
  }

  /**
   * Get final resolved rules for production
   * @param {Object} resolvedContext - Resolved context
   * @returns {Object} Final rules
   */
  static getFinalRules(resolvedContext) {
    return resolvedContext.resolved_rules.production;
  }
}

module.exports = { ContextResolver };
