/**
 * V2.1 Bible Contract
 * 
 * Defines the structure for production bibles in the multi-tenant content factory.
 */

/**
 * @typedef {Object} ProductionBible
 * @property {string} production_id - Production UUID
 * @property {BusinessContext} business - Business context
 * @property {BrandContext} brand - Brand context
 * @property {UniverseContext} universe - Content universe/series context
 * @property {Array<string>} character_ids - Character UUIDs
 * @property {Array<string>} location_ids - Location UUIDs
 * @property {string} style_id - Style UUID
 * @property {string} voice_id - Voice UUID
 * @property {Array<string>} prop_ids - Prop UUIDs
 * @property {BrandRules} brand_rules - Brand compliance rules
 * @property {VisualRules} visual_rules - Visual style rules
 * @property {CameraRules} camera_rules - Camera direction rules
 * @property {LightingRules} lighting_rules - Lighting rules
 * @property {ContinuityRules} continuity_rules - Continuity requirements
 * @property {Array<string>} negative_constraints - What to avoid
 * @property {FormatRules} format_rules - Format rules (duration, aspect ratio, etc.)
 * @property {string} topic - Content topic
 */

/**
 * @typedef {Object} BusinessContext
 * @property {string} id - Business UUID
 * @property {string} name - Business name
 * @property {string} industry - Industry
 * @property {Object} settings - Business settings
 */

/**
 * @typedef {Object} BrandContext
 * @property {string} id - Brand UUID
 * @property {string} name - Brand name
 * @property {BrandIdentity} identity - Brand identity
 * @property {Array<BrandRule>} rules - Brand rules
 */

/**
 * @typedef {Object} UniverseContext
 * @property {string} id - Universe UUID
 * @property {string} name - Universe name
 * @property {'campaign' | 'series' | 'recurring_format'} type - Universe type
 * @property {Object} format_rules - Format rules
 * @property {Object} recurring_elements - Recurring elements
 */

/**
 * @typedef {Object} BrandIdentity
 * @property {string} tone - Brand tone
 * @property {Object} voice_profile - Voice characteristics
 * @property {Object} visual_language - Visual style
 * @property {Object} color_palette - Colors
 */

/**
 * @typedef {Object} BrandRule
 * @property {'compliance' | 'style' | 'content' | 'technical'} rule_type - Rule category
 * @property {string} category - Specific category
 * @property {'prohibited' | 'required' | 'recommended'} constraint_type - Constraint type
 * @property {Object} constraint_value - Constraint value
 * @property {'low' | 'medium' | 'high' | 'critical'} severity - Severity
 */

/**
 * @typedef {Object} VisualRules
 * @property {string} style - Visual style
 * @property {string} color_palette - Color scheme
 * @property {string} composition - Composition rules
 */

/**
 * @typedef {Object} CameraRules
 * @property {string} movement - Camera movement
 * @property {string} angles - Camera angles
 * @property {string} focus - Focus style
 */

/**
 * @typedef {Object} LightingRules
 * @property {string} type - Lighting type
 * @property {string} mood - Lighting mood
 * @property {string} direction - Light direction
 */

/**
 * @typedef {Object} ContinuityRules
 * @property {string} character_identity - Character consistency
 * @property {string} wardrobe - Wardrobe consistency
 * @property {string} location - Location consistency
 * @property {string} props - Prop consistency
 */

/**
 * @typedef {Object} FormatRules
 * @property {number} duration_ms - Duration in milliseconds
 * @property {'9:16' | '16:9' | '1:1' | '4:5'} aspect_ratio - Aspect ratio
 * @property {'question' | 'statement' | 'unexpected'} hook_style - Hook style
 * @property {'visit' | 'download' | 'purchase' | 'learn_more'} cta - Call-to-action type
 */

module.exports = {
  /**
   * Validate production bible
   * @param {ProductionBible} bible
   * @returns {boolean}
   */
  validateBible(bible) {
    if (!bible.production_id) return false;
    if (!bible.business) return false;
    if (!bible.brand) return false;
    if (!bible.brand_rules) return false;
    if (!bible.visual_rules) return false;
    return true;
  }
};
