/**
 * Request validation utilities
 */

/**
 * Validate production creation request
 * @param {Object} body - Request body
 * @returns {Object} Validation result
 */
function validateCreateProduction(body) {
  const errors = [];

  // Validate business_id
  if (!body.business_id) {
    errors.push('business_id is required');
  } else if (typeof body.business_id !== 'string') {
    errors.push('business_id must be a string');
  }

  // Validate brand_id
  if (!body.brand_id) {
    errors.push('brand_id is required');
  } else if (typeof body.brand_id !== 'string') {
    errors.push('brand_id must be a string');
  }

  // Validate topic
  if (!body.topic) {
    errors.push('topic is required');
  } else if (typeof body.topic !== 'string') {
    errors.push('topic must be a string');
  } else if (body.topic.length < 10) {
    errors.push('topic must be at least 10 characters');
  }

  // Validate platforms
  if (!body.platforms || !Array.isArray(body.platforms)) {
    errors.push('platforms array is required');
  } else {
    const validPlatforms = ['tiktok', 'instagram', 'youtube'];
    body.platforms.forEach(platform => {
      if (!validPlatforms.includes(platform)) {
        errors.push(`Invalid platform: ${platform}. Valid: ${validPlatforms.join(', ')}`);
      }
    });
  }

  // Validate optional fields
  if (body.series_id && typeof body.series_id !== 'string') {
    errors.push('series_id must be a string');
  }

  if (body.audience_id && typeof body.audience_id !== 'string') {
    errors.push('audience_id must be a string');
  }

  if (body.product_id && typeof body.product_id !== 'string') {
    errors.push('product_id must be a string');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate UUID format
 * @param {string} uuid - UUID string
 * @returns {boolean}
 */
function isValidUuid(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

module.exports = {
  validateCreateProduction,
  isValidUuid
};
