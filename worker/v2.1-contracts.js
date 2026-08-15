/**
 * V2.1 Contracts
 * 
 * Shared type contracts and validation utilities for the multi-tenant content factory.
 * Ensures consistency across all factory components.
 */

/**
 * @typedef {Object} Tenant
 * @property {string} id - Tenant UUID
 * @property {string} name - Tenant name
 * @property {string} slug - Unique slug
 * @property {'standard' | 'pro' | 'enterprise'} tier - Subscription tier
 * @property {Object} settings - Tenant-specific settings
 * @property {'active' | 'suspended'} status - Tenant status
 */

/**
 * @typedef {Object} Business
 * @property {string} id - Business UUID
 * @property {string} tenant_id - Parent tenant UUID
 * @property {string} name - Business name
 * @property {string} slug - Unique slug
 * @property {string} industry - Industry (e.g., 'food_beverage', 'home_services')
 * @property {string} description - Business description
 * @property {string} website - Business website URL
 * @property {Object} settings - Business-specific settings
 * @property {'active' | 'inactive'} status - Business status
 */

/**
 * @typedef {Object} Brand
 * @property {string} id - Brand UUID
 * @property {string} business_id - Parent business UUID
 * @property {string} name - Brand name
 * @property {string} slug - Unique slug
 * @property {string} tagline - Brand tagline
 * @property {string} mission - Brand mission statement
 * @property {Object} settings - Brand-specific settings
 * @property {'active' | 'inactive'} status - Brand status
 */

/**
 * @typedef {Object} BrandIdentity
 * @property {string} id - Identity UUID
 * @property {string} brand_id - Parent brand UUID
 * @property {number} version - Identity version (for versioning)
 * @property {Object} voice_profile - Voice characteristics
 * @property {string} tone - Brand tone (e.g., 'funny', 'trustworthy')
 * @property {Object} personality_traits - Personality attributes
 * @property {Object} visual_language - Visual style description
 * @property {Object} color_palette - Brand colors
 * @property {Object} typography - Typography rules
 * @property {string} logo_uri - Logo image URL
 * @property {boolean} is_active - Whether this identity is active
 */

/**
 * @typedef {Object} BrandRule
 * @property {string} id - Rule UUID
 * @property {string} brand_id - Parent brand UUID
 * @property {'compliance' | 'style' | 'content' | 'technical'} rule_type - Rule category
 * @property {string} category - Specific category
 * @property {string} description - Rule description
 * @property {'prohibited' | 'required' | 'recommended'} constraint_type - Constraint type
 * @property {Object} constraint_value - Constraint value (JSON)
 * @property {'low' | 'medium' | 'high' | 'critical'} severity - Rule severity
 * @property {boolean} is_active - Whether rule is active
 */

/**
 * @typedef {Object} Audience
 * @property {string} id - Audience UUID
 * @property {string} business_id - Parent business UUID
 * @property {string} name - Audience name
 * @property {string} description - Audience description
 * @property {Object} demographics - Demographic data (age, gender, location)
 * @property {Object} psychographics - Psychographic data (interests, values)
 * @property {Object} behaviors - Behavioral data (platforms, habits)
 * @property {Object} pain_points - Audience pain points
 * @property {Object} goals - Audience goals
 * @property {Array<string>} platforms - Target platforms
 * @property {number} size_estimate - Estimated audience size
 * @property {boolean} is_active - Whether audience is active
 */

/**
 * @typedef {Object} Product
 * @property {string} id - Product UUID
 * @property {string} business_id - Parent business UUID
 * @property {string} name - Product name
 * @property {'product' | 'service'} type - Product type
 * @property {string} description - Product description
 * @property {string} category - Product category
 * @property {number} price - Product price
 * @property {string} currency - Currency code
 * @property {Object} features - Product features
 * @property {Object} benefits - Product benefits
 * @property {string} target_audience - Target audience UUID
 * @property {Object} images - Product images
 * @property {Object} metadata - Additional metadata
 * @property {boolean} is_active - Whether product is active
 */

/**
 * @typedef {Object} ContentStrategy
 * @property {string} id - Strategy UUID
 * @property {string} brand_id - Parent brand UUID
 * @property {string} name - Strategy name
 * @property {string} description - Strategy description
 * @property {Object} objectives - Content objectives
 * @property {Object} kpis - Key performance indicators
 * @property {Array<string>} content_pillars - Content pillars
 * @property {Object} messaging_framework - Messaging framework
 * @property {Object} posting_frequency - Posting schedule
 * @property {Object} platform_priorities - Platform priorities
 * @property {Object} competitive_positioning - Competitive positioning
 * @property {boolean} is_active - Whether strategy is active
 */

/**
 * @typedef {Object} ContentUniverse
 * @property {string} id - Universe UUID
 * @property {string} brand_id - Parent brand UUID
 * @property {string} parent_universe_id - Parent universe UUID (for nested universes)
 * @property {string} name - Universe name
 * @property {'campaign' | 'series' | 'recurring_format'} type - Universe type
 * @property {string} description - Universe description
 * @property {Object} format_rules - Format rules (duration, aspect ratio, etc.)
 * @property {Object} recurring_elements - Recurring elements (characters, locations)
 * @property {string} target_audience - Target audience UUID
 * @property {Object} target_products - Target products
 * @property {Object} settings - Universe-specific settings
 * @property {'active' | 'completed' | 'paused'} status - Universe status
 * @property {string} started_at - Start date (ISO)
 * @property {string} ended_at - End date (ISO)
 */

/**
 * @typedef {Object} KnowledgeBase
 * @property {string} id - Knowledge UUID
 * @property {string} business_id - Parent business UUID
 * @property {string} brand_id - Parent brand UUID (optional)
 * @property {string} category - Knowledge category
 * @property {string} title - Knowledge title
 * @property {string} content - Knowledge content
 * @property {Array<string>} tags - Knowledge tags
 * @property {Array<string>} sources - Knowledge sources
 * @property {number} confidence - Confidence score (0-1)
 * @property {boolean} is_verified - Whether knowledge is verified
 * @property {string} expires_at - Expiration date (ISO)
 */

/**
 * @typedef {Object} IndustryPolicy
 * @property {string} id - Policy UUID
 * @property {string} industry - Industry (e.g., 'food_beverage', 'healthcare')
 * @property {string} name - Policy name
 * @property {string} description - Policy description
 * @property {Array<Object>} rules - Policy rules (JSON)
 * @property {Array<string>} regions - Applicable regions
 * @property {'low' | 'medium' | 'high' | 'critical'} severity - Policy severity
 * @property {boolean} is_mandatory - Whether policy is mandatory
 */

/**
 * @typedef {Object} GlobalTrend
 * @property {string} id - Trend UUID
 * @property {string} source - Trend source (e.g., 'tiktok', 'google_trends')
 * @property {string} trend_id - External trend ID
 * @property {string} title - Trend title
 * @property {string} description - Trend description
 * @property {string} category - Trend category
 * @property {Array<string>} platforms - Platforms where trend is active
 * @property {Array<string>} regions - Regions where trend is active
 * @property {number} volume_score - Trend volume score (0-1)
 * @property {number} velocity_score - Trend velocity score (0-1)
 * @property {number} engagement_score - Trend engagement score (0-1)
 * @property {string} started_at - Trend start date (ISO)
 * @property {string} peaked_at - Trend peak date (ISO)
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} TrendRelevance
 * @property {string} id - Relevance UUID
 * @property {string} trend_id - Trend UUID
 * @property {string} business_id - Business UUID
 * @property {string} brand_id - Brand UUID
 * @property {string} audience_id - Audience UUID
 * @property {number} relevance_score - Relevance score (0-1)
 * @property {number} opportunity_score - Opportunity score (0-1)
 * @property {number} risk_score - Risk score (0-1)
 * @property {string} recommended_action - Recommended action
 * @property {string} reasoning - Reasoning text
 */

/**
 * @typedef {Object} GlobalLearning
 * @property {string} id - Learning UUID
 * @property {string} pattern - Pattern name (e.g., 'question_hook')
 * @property {string} category - Learning category
 * @property {string} description - Learning description
 * @property {number} evidence_count - Number of evidence instances
 * @property {number} confidence - Confidence score (0-1)
 * @property {Array<string>} platforms - Platforms where pattern applies
 * @property {Array<string>} industries - Industries where pattern applies
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} BusinessLearning
 * @property {string} id - Learning UUID
 * @property {string} business_id - Business UUID
 * @property {string} parent_global_id - Parent global learning UUID
 * @property {string} pattern - Pattern name
 * @property {string} category - Learning category
 * @property {string} description - Learning description
 * @property {number} evidence_count - Number of evidence instances
 * @property {number} confidence - Confidence score (0-1)
 * @property {Array<string>} sources - Learning sources
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} BrandLearning
 * @property {string} id - Learning UUID
 * @property {string} brand_id - Brand UUID
 * @property {string} parent_business_id - Parent business learning UUID
 * @property {string} pattern - Pattern name
 * @property {string} category - Learning category
 * @property {string} description - Learning description
 * @property {number} evidence_count - Number of evidence instances
 * @property {number} confidence - Confidence score (0-1)
 * @property {Array<string>} sources - Learning sources
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} SeriesLearning
 * @property {string} id - Learning UUID
 * @property {string} universe_id - Content universe UUID
 * @property {string} parent_brand_id - Parent brand learning UUID
 * @property {string} pattern - Pattern name
 * @property {string} category - Learning category
 * @property {string} description - Learning description
 * @property {number} evidence_count - Number of evidence instances
 * @property {number} confidence - Confidence score (0-1)
 * @property {Array<string>} sources - Learning sources
 * @property {Object} metadata - Additional metadata
 */

module.exports = {
  validateTenant(tenant) {
    if (!tenant.id) return false;
    if (!tenant.name) return false;
    if (!tenant.slug) return false;
    if (!tenant.tier) return false;
    return true;
  },

  validateBusiness(business) {
    if (!business.id) return false;
    if (!business.tenant_id) return false;
    if (!business.name) return false;
    if (!business.industry) return false;
    return true;
  },

  validateBrand(brand) {
    if (!brand.id) return false;
    if (!brand.business_id) return false;
    if (!brand.name) return false;
    return true;
  },

  validateAudience(audience) {
    if (!audience.id) return false;
    if (!audience.business_id) return false;
    if (!audience.name) return false;
    return true;
  },

  validateContentUniverse(universe) {
    if (!universe.id) return false;
    if (!universe.brand_id) return false;
    if (!universe.name) return false;
    if (!universe.type) return false;
    return true;
  }
};
