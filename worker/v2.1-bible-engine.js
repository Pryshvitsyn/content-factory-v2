const BibleContract = require('./v2.1-bible-contract');

/**
 * V2.1 Bible Engine
 * 
 * Generates production bible from resolved context.
 * The bible is the creative source of truth for a production.
 */
class BibleEngine {
  /**
   * Generate production bible from resolved context
   * @param {Object} resolvedContext - Resolved context from ContextResolver
   * @returns {Object} Production bible
   */
  static generate(resolvedContext) {
    const rules = resolvedContext.resolved_rules.production;
    
    const bible = {
      production_id: resolvedContext.production.id,
      topic: resolvedContext.content.topic,
      
      // Business context
      business: {
        id: resolvedContext.business.id,
        name: resolvedContext.business.name,
        industry: resolvedContext.business.industry
      },
      
      // Brand context
      brand: {
        id: resolvedContext.brand.id,
        name: resolvedContext.brand.name,
        identity: resolvedContext.brand.identity
      },
      
      // Universe context (if exists)
      universe: resolvedContext.universe ? {
        id: resolvedContext.universe.id,
        name: resolvedContext.universe.name,
        type: resolvedContext.universe.type
      } : null,
      
      // Creative rules (resolved from inheritance)
      brand_rules: this.extractBrandRules(rules),
      visual_rules: this.extractVisualRules(rules),
      camera_rules: this.extractCameraRules(rules),
      lighting_rules: this.extractLightingRules(rules),
      continuity_rules: this.extractContinuityRules(rules),
      negative_constraints: this.extractNegativeConstraints(rules),
      
      // Format rules
      format_rules: {
        duration_ms: rules.format_rules?.duration_ms || 20000,
        aspect_ratio: rules.format_rules?.aspect_ratio || '9:16',
        hook_style: rules.format_rules?.hook_style || 'unexpected',
        cta: rules.format_rules?.cta || 'visit'
      },
      
      // Production-specific
      hook: resolvedContext.production.hook,
      angle: resolvedContext.production.angle,
      cta: resolvedContext.production.cta,
      target_platform: resolvedContext.production.target_platform
    };
    
    // Validate bible structure
    if (!BibleContract.validateBible(bible)) {
      throw new Error('Generated bible failed validation');
    }
    
    return bible;
  }

  /**
   * Extract brand rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Object} Brand rules
   */
  static extractBrandRules(rules) {
    return {
      tone: rules.tone,
      visual_language: rules.visual_language,
      forbidden: this.extractForbiddenRules(rules),
      required: this.extractRequiredRules(rules)
    };
  }

  /**
   * Extract visual rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Object} Visual rules
   */
  static extractVisualRules(rules) {
    return {
      style: rules.visual_language?.style || 'warm_cinematic',
      color_palette: rules.color_palette || {},
      composition: rules.visual_language?.composition || 'rule_of_thirds'
    };
  }

  /**
   * Extract camera rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Object} Camera rules
   */
  static extractCameraRules(rules) {
    return {
      movement: rules.visual_language?.camera_movement || 'dynamic',
      angles: rules.visual_language?.camera_angles || ['close-up', 'medium'],
      focus: rules.visual_language?.focus || 'shallow'
    };
  }

  /**
   * Extract lighting rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Object} Lighting rules
   */
  static extractLightingRules(rules) {
    return {
      type: rules.visual_language?.lighting_type || 'natural',
      mood: rules.visual_language?.lighting_mood || 'warm',
      direction: rules.visual_language?.lighting_direction || 'front'
    };
  }

  /**
   * Extract continuity rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Object} Continuity rules
   */
  static extractContinuityRules(rules) {
    return {
      character_identity: 'must_match_reference',
      wardrobe: 'consistent_across_shots',
      location: 'must_match_bible',
      props: 'consistent_across_shots'
    };
  }

  /**
   * Extract forbidden rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Array<string>} Forbidden rules
   */
  static extractForbiddenRules(rules) {
    const forbidden = [];
    
    // Add compliance-based forbidden rules
    if (rules.compliance) {
      rules.compliance.forEach(policy => {
        if (policy.rules) {
          policy.rules.forEach(rule => {
            if (rule.type === 'prohibited') {
              forbidden.push(`${rule.category}: ${rule.description}`);
            }
          });
        }
      });
    }
    
    // Add brand-specific forbidden rules
    if (rules.brand_specific_rules) {
      rules.brand_specific_rules.forEach(rule => {
        if (rule.constraint_type === 'prohibited') {
          forbidden.push(`${rule.category}: ${rule.constraint_value}`);
        }
      });
    }
    
    return forbidden;
  }

  /**
   * Extract required rules from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Array<string>} Required rules
   */
  static extractRequiredRules(rules) {
    const required = [];
    
    // Add compliance-based required rules
    if (rules.compliance) {
      rules.compliance.forEach(policy => {
        if (policy.rules) {
          policy.rules.forEach(rule => {
            if (rule.type === 'required') {
              required.push(`${rule.category}: ${rule.description}`);
            }
          });
        }
      });
    }
    
    // Add brand-specific required rules
    if (rules.brand_specific_rules) {
      rules.brand_specific_rules.forEach(rule => {
        if (rule.constraint_type === 'required') {
          required.push(`${rule.category}: ${rule.constraint_value}`);
        }
      });
    }
    
    return required;
  }

  /**
   * Extract negative constraints from resolved rules
   * @param {Object} rules - Resolved rules
   * @returns {Array<string>} Negative constraints
   */
  static extractNegativeConstraints(rules) {
    const constraints = [];
    
    // Add industry-specific negative constraints
    if (rules.industry === 'food_beverage') {
      constraints.push('no_unverified_health_claims');
      constraints.push('no_misleading_nutrition_info');
    } else if (rules.industry === 'healthcare') {
      constraints.push('no_medical_claims_without_approval');
      constraints.push('must_include_disclaimer');
    } else if (rules.industry === 'finance') {
      constraints.push('no_guaranteed_returns');
      constraints.push('must_include_risk_warning');
    } else if (rules.industry === 'home_services') {
      constraints.push('no_guaranteed_outcomes');
      constraints.push('must_mention_licensing_if_applicable');
    }
    
    return constraints;
  }
}

module.exports = { BibleEngine };
