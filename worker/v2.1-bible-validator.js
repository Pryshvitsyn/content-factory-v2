const BibleContract = require('./v2.1-bible-contract');

/**
 * V2.1 Bible Validator
 * 
 * Validates production bible against:
 * - Brand rules (tone, visual language, forbidden content)
 * - Compliance rules (industry policies)
 * - Continuity rules (character, location, prop consistency)
 * - Technical rules (format, duration, aspect ratio)
 */
class BibleValidator {
  /**
   * Validate production bible
   * @param {Object} bible - Production bible
   * @returns {Object} Validation result
   */
  static validate(bible) {
    const issues = [];
    
    // Validate structure
    if (!BibleContract.validateBible(bible)) {
      issues.push('Bible structure is invalid');
    }
    
    // Validate brand rules
    const brandValidation = this.validateBrandRules(bible);
    issues.push(...brandValidation);
    
    // Validate compliance
    const complianceValidation = this.validateCompliance(bible);
    issues.push(...complianceValidation);
    
    // Validate continuity
    const continuityValidation = this.validateContinuity(bible);
    issues.push(...continuityValidation);
    
    // Validate technical rules
    const technicalValidation = this.validateTechnicalRules(bible);
    issues.push(...technicalValidation);
    
    return {
      passed: issues.length === 0,
      issues: issues
    };
  }

  /**
   * Validate brand rules
   * @param {Object} bible - Production bible
   * @returns {Array<string>} Issues
   */
  static validateBrandRules(bible) {
    const issues = [];
    
    // Check tone consistency
    if (!bible.brand_rules.tone) {
      issues.push('Brand tone is missing');
    }
    
    // Check visual language
    if (!bible.brand_rules.visual_language) {
      issues.push('Brand visual language is missing');
    }
    
    // Check forbidden content
    if (bible.brand_rules.forbidden && bible.brand_rules.forbidden.length > 0) {
      // TODO: Validate that content doesn't violate forbidden rules
      // For now, just check that forbidden rules exist
    }
    
    return issues;
  }

  /**
   * Validate compliance rules
   * @param {Object} bible - Production bible
   * @returns {Array<string>} Issues
   */
  static validateCompliance(bible) {
    const issues = [];
    
    // Check industry-specific compliance
    const industry = bible.business.industry;
    
    if (industry === 'food_beverage') {
      // Check for health claims
      if (bible.negative_constraints.includes('no_unverified_health_claims')) {
        // TODO: Validate script doesn't contain health claims
      }
    } else if (industry === 'healthcare') {
      // Check for medical claims
      if (bible.negative_constraints.includes('no_medical_claims_without_approval')) {
        // TODO: Validate script doesn't contain medical claims
      }
      
      // Check for disclaimer
      if (bible.brand_rules.required && bible.brand_rules.required.includes('disclaimer')) {
        // TODO: Validate that disclaimer is present
      }
    } else if (industry === 'finance') {
      // Check for guaranteed returns
      if (bible.negative_constraints.includes('no_guaranteed_returns')) {
        // TODO: Validate script doesn't guarantee returns
      }
      
      // Check for risk warning
      if (bible.brand_rules.required && bible.brand_rules.required.includes('risk_warning')) {
        // TODO: Validate that risk warning is present
      }
    }
    
    return issues;
  }

  /**
   * Validate continuity rules
   * @param {Object} bible - Production bible
   * @returns {Array<string>} Issues
   */
  static validateContinuity(bible) {
    const issues = [];
    
    // Check character consistency
    if (!bible.continuity_rules.character_identity) {
      issues.push('Character identity rules are missing');
    }
    
    // Check location consistency
    if (!bible.continuity_rules.location) {
      issues.push('Location consistency rules are missing');
    }
    
    // Check prop consistency
    if (!bible.continuity_rules.props) {
      issues.push('Prop consistency rules are missing');
    }
    
    return issues;
  }

  /**
   * Validate technical rules
   * @param {Object} bible - Production bible
   * @returns {Array<string>} Issues
   */
  static validateTechnicalRules(bible) {
    const issues = [];
    
    // Check duration
    if (!bible.format_rules.duration_ms || bible.format_rules.duration_ms <= 0) {
      issues.push('Invalid duration');
    }
    
    // Check aspect ratio
    const validAspectRatios = ['9:16', '16:9', '1:1', '4:5'];
    if (!validAspectRatios.includes(bible.format_rules.aspect_ratio)) {
      issues.push(`Invalid aspect ratio: ${bible.format_rules.aspect_ratio}`);
    }
    
    // Check hook style
    const validHookStyles = ['question', 'statement', 'unexpected'];
    if (!validHookStyles.includes(bible.format_rules.hook_style)) {
      issues.push(`Invalid hook style: ${bible.format_rules.hook_style}`);
    }
    
    // Check CTA
    const validCTAs = ['visit', 'download', 'purchase', 'learn_more'];
    if (!validCTAs.includes(bible.format_rules.cta)) {
      issues.push(`Invalid CTA: ${bible.format_rules.cta}`);
    }
    
    return issues;
  }

  /**
   * Validate shot against bible
   * @param {Object} shot - Shot object
   * @param {Object} bible - Production bible
   * @returns {Object} Validation result
   */
  static validateShot(shot, bible) {
    const issues = [];
    
    // Check duration
    if (shot.duration_ms > bible.format_rules.duration_ms) {
      issues.push(`Shot duration (${shot.duration_ms}ms) exceeds bible duration (${bible.format_rules.duration_ms}ms)`);
    }
    
    // Check character consistency
    if (shot.characters && shot.characters.length > 0) {
      // TODO: Validate characters match bible characters
    }
    
    // Check location consistency
    if (shot.location) {
      // TODO: Validate location matches bible location
    }
    
    return {
      passed: issues.length === 0,
      issues: issues
    };
  }
}

module.exports = { BibleValidator };
