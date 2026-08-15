const BibleContract = require('./v2.1-bible-contract');

/**
 * V2.1 Production Boundary
 * 
 * Enforces production boundaries and constraints:
 * - Maximum duration
 * - Allowed characters
 * - Allowed locations
 * - Brand safety boundaries
 * - Compliance boundaries
 */
class ProductionBoundary {
  /**
   * Enforce production boundaries
   * @param {Object} bible - Production bible
   */
  static enforce(bible) {
    // Enforce duration boundary
    this.enforceDurationBoundary(bible);
    
    // Enforce character boundary
    this.enforceCharacterBoundary(bible);
    
    // Enforce location boundary
    this.enforceLocationBoundary(bible);
    
    // Enforce brand safety boundary
    this.enforceBrandSafetyBoundary(bible);
    
    // Enforce compliance boundary
    this.enforceComplianceBoundary(bible);
  }

  /**
   * Enforce duration boundary
   * @param {Object} bible - Production bible
   */
  static enforceDurationBoundary(bible) {
    const maxDuration = bible.format_rules.duration_ms;
    
    if (!maxDuration || maxDuration <= 0) {
      throw new Error('Invalid duration boundary');
    }
    
    // TikTok/Reels/Shorts max: 60 seconds
    if (maxDuration > 60000) {
      throw new Error(`Duration ${maxDuration}ms exceeds maximum 60000ms`);
    }
  }

  /**
   * Enforce character boundary
   * @param {Object} bible - Production bible
   */
  static enforceCharacterBoundary(bible) {
    // TODO: Validate that only allowed characters are used
    // Characters should come from universe or brand
  }

  /**
   * Enforce location boundary
   * @param {Object} bible - Production bible
   */
  static enforceLocationBoundary(bible) {
    // TODO: Validate that only allowed locations are used
    // Locations should come from universe or brand
  }

  /**
   * Enforce brand safety boundary
   * @param {Object} bible - Production bible
   */
  static enforceBrandSafetyBoundary(bible) {
    // Check forbidden content
    if (bible.brand_rules.forbidden && bible.brand_rules.forbidden.length > 0) {
      // TODO: Validate that content doesn't violate forbidden rules
    }
    
    // Check negative constraints
    if (bible.negative_constraints && bible.negative_constraints.length > 0) {
      // TODO: Validate that content doesn't violate negative constraints
    }
  }

  /**
   * Enforce compliance boundary
   * @param {Object} bible - Production bible
   */
  static enforceComplianceBoundary(bible) {
    const industry = bible.business.industry;
    
    if (industry === 'food_beverage') {
      // Enforce food & beverage compliance
      this.enforceFoodBeverageCompliance(bible);
    } else if (industry === 'healthcare') {
      // Enforce healthcare compliance
      this.enforceHealthcareCompliance(bible);
    } else if (industry === 'finance') {
      // Enforce finance compliance
      this.enforceFinanceCompliance(bible);
    } else if (industry === 'home_services') {
      // Enforce home services compliance
      this.enforceHomeServicesCompliance(bible);
    }
  }

  /**
   * Enforce food & beverage compliance
   * @param {Object} bible - Production bible
   */
  static enforceFoodBeverageCompliance(bible) {
    // Check for health claims
    if (bible.negative_constraints.includes('no_unverified_health_claims')) {
      // TODO: Validate script doesn't contain health claims
    }
    
    // Check for allergen disclosure
    if (bible.brand_rules.required && bible.brand_rules.required.some(r => r.includes('allergen'))) {
      // TODO: Validate that allergens are disclosed if mentioned
    }
  }

  /**
   * Enforce healthcare compliance
   * @param {Object} bible - Production bible
   */
  static enforceHealthcareCompliance(bible) {
    // Check for medical claims
    if (bible.negative_constraints.includes('no_medical_claims_without_approval')) {
      // TODO: Validate script doesn't contain medical claims
    }
    
    // Check for disclaimer
    if (bible.brand_rules.required && bible.brand_rules.required.some(r => r.includes('disclaimer'))) {
      // TODO: Validate that disclaimer is present
    }
  }

  /**
   * Enforce finance compliance
   * @param {Object} bible - Production bible
   */
  static enforceFinanceCompliance(bible) {
    // Check for guaranteed returns
    if (bible.negative_constraints.includes('no_guaranteed_returns')) {
      // TODO: Validate script doesn't guarantee returns
    }
    
    // Check for risk warning
    if (bible.brand_rules.required && bible.brand_rules.required.some(r => r.includes('risk'))) {
      // TODO: Validate that risk warning is present
    }
  }

  /**
   * Enforce home services compliance
   * @param {Object} bible - Production bible
   */
  static enforceHomeServicesCompliance(bible) {
    // Check for guaranteed outcomes
    if (bible.negative_constraints.includes('no_guaranteed_outcomes')) {
      // TODO: Validate script doesn't guarantee outcomes
    }
    
    // Check for licensing disclosure
    if (bible.brand_rules.required && bible.brand_rules.required.some(r => r.includes('licensing'))) {
      // TODO: Validate that licensing is mentioned if applicable
    }
  }

  /**
   * Check if content violates brand safety
   * @param {Object} content - Content to check
   * @param {Object} bible - Production bible
   * @returns {boolean}
   */
  static isBrandSafe(content, bible) {
    // Check forbidden content
    if (bible.brand_rules.forbidden) {
      bible.brand_rules.forbidden.forEach(forbidden => {
        if (content.includes(forbidden)) {
          return false;
        }
      });
    }
    
    // Check negative constraints
    if (bible.negative_constraints) {
      bible.negative_constraints.forEach(constraint => {
        if (content.includes(constraint)) {
          return false;
        }
      });
    }
    
    return true;
  }
}

module.exports = { ProductionBoundary };
