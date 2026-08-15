const express = require('express');
const { getDb } = require('../lib/db');
const { validateCreateProduction, isValidUuid } = require('../lib/validation');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * POST /api/productions
 * Create a new video production
 * 
 * Request body:
 * {
 *   "business_id": "uuid",
 *   "brand_id": "uuid",
 *   "topic": "Why Roman pizza is thin",
 *   "platforms": ["tiktok", "instagram"],
 *   "series_id": "uuid" (optional),
 *   "audience_id": "uuid" (optional),
 *   "product_id": "uuid" (optional)
 * }
 * 
 * Response:
 * {
 *   "id": "production-uuid",
 *   "status": "queued",
 *   "message": "Production created. Script generation started."
 * }
 */
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const body = req.body;

    // Validate request
    const validation = validateCreateProduction(body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.errors
      });
    }

    // Validate business exists
    const businessResult = await db.query(
      'SELECT id FROM businesses WHERE id = $1',
      [body.business_id]
    );
    if (businessResult.rows.length === 0) {
      return res.status(400).json({ error: 'Business not found' });
    }

    // Validate brand exists
    const brandResult = await db.query(
      'SELECT id FROM brands WHERE id = $1',
      [body.brand_id]
    );
    if (brandResult.rows.length === 0) {
      return res.status(400).json({ error: 'Brand not found' });
    }

    // Create content
    const contentResult = await db.query(
      `INSERT INTO contents (business_id, title, topic, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [body.business_id, body.topic, body.topic]
    );
    const contentId = contentResult.rows[0].id;

    // Create content variant
    const variantResult = await db.query(
      `INSERT INTO content_variants (content_id, brand_id, hook, target_platform, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id`,
      [contentId, body.brand_id, body.topic, body.platforms[0]]
    );
    const variantId = variantResult.rows[0].id;

    // Create production
    const productionResult = await db.query(
      `INSERT INTO productions (content_variant_id, universe_id, title, status)
       VALUES ($1, $2, $3, 'queued')
       RETURNING id`,
      [variantId, body.series_id || null, body.topic]
    );
    const productionId = productionResult.rows[0].id;

    // Create SCRIPT_GENERATION job
    const jobResult = await db.query(
      `INSERT INTO jobs (production_id, job_type, status, priority)
       VALUES ($1, 'SCRIPT_GENERATION', 'queued', 1)
       RETURNING id`,
      [productionId]
    );

    // Create editions for each platform
    for (const platform of body.platforms) {
      const editionType = platform === 'tiktok' ? 'vertical_short' :
n                          platform === 'instagram' ? 'reel' :
                          platform === 'youtube' ? 'short' : 'vertical_short';
      const aspectRatio = platform === 'youtube' ? '16:9' : '9:16';

      await db.query(
        `INSERT INTO editions (production_id, platform, edition_type, aspect_ratio, status)
         VALUES ($1, $2, $3, $4, 'draft')`,
        [productionId, platform, editionType, aspectRatio]
      );
    }

    console.log(`✅ Production ${productionId} created for business ${body.business_id}`);

    res.status(201).json({
      id: productionId,
      status: 'queued',
      message: 'Production created. Script generation started.'
    });

  } catch (error) {
    console.error('Error creating production:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/productions
 * List all productions for a business
 * 
 * Query params:
 * - business_id (required)
 * - limit (optional, default 20)
 * - offset (optional, default 0)
 * 
 * Response:
 * [
 *   {
 *     "id": "uuid",
 *     "title": "Why Roman pizza is thin",
 *     "status": "completed",
 *     "created_at": "2026-08-16T00:00:00Z",
 *     "platforms": ["tiktok", "instagram"],
 *     "editions": [...]
 *   }
 * ]
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { business_id, limit = 20, offset = 0 } = req.query;

    if (!business_id) {
      return res.status(400).json({ error: 'business_id query param is required' });
    }

    const result = await db.query(
      `SELECT 
        p.id,
        p.title,
        p.status,
        p.created_at,
        p.updated_at,
        cv.target_platform,
        e.platforms as edition_platforms
       FROM productions p
       JOIN content_variants cv ON p.content_variant_id = cv.id
       JOIN contents c ON cv.content_id = c.id
       LEFT JOIN (
         SELECT production_id, ARRAY_AGG(DISTINCT platform) as platforms
         FROM editions
         GROUP BY production_id
       ) e ON p.id = e.production_id
       WHERE c.business_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [business_id, parseInt(limit), parseInt(offset)]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Error listing productions:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/productions/:id
 * Get production details and status
 * 
 * Response:
 * {
 *   "id": "uuid",
 *   "title": "Why Roman pizza is thin",
 *   "status": "completed",
 *   "progress": 75,
 *   "stages": [...],
 *   "artifacts": [...],
 *   "editions": [...]
 * }
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid production ID' });
    }

    // Get production details
    const productionResult = await db.query(
      `SELECT * FROM productions WHERE id = $1`,
      [id]
    );

    if (productionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Production not found' });
    }

    const production = productionResult.rows[0];

    // Get jobs for this production
    const jobsResult = await db.query(
      `SELECT * FROM jobs WHERE production_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // Get artifacts for this production
    const artifactsResult = await db.query(
      `SELECT * FROM artifacts WHERE production_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // Get editions for this production
    const editionsResult = await db.query(
      `SELECT * FROM editions WHERE production_id = $1`,
      [id]
    );

    // Calculate progress
    const totalJobs = jobsResult.rows.length;
    const completedJobs = jobsResult.rows.filter(j => j.status === 'completed').length;
    const progress = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

    res.json({
      ...production,
      progress,
      jobs: jobsResult.rows,
      artifacts: artifactsResult.rows,
      editions: editionsResult.rows
    });

  } catch (error) {
    console.error('Error getting production:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/productions/:id/approve
 * Approve a production (mark as ready for publishing)
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    await db.query(
      `UPDATE productions SET status = 'approved' WHERE id = $1`,
      [id]
    );

    res.json({ status: 'approved', message: 'Production approved' });

  } catch (error) {
    console.error('Error approving production:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/productions/:id/publish
 * Publish a production to platforms
 * 
 * Request body:
 * {
 *   "platforms": ["tiktok", "instagram"],
 *   "scheduled_at": "2026-08-16T18:00:00Z" (optional)
 * }
 */
router.post('/:id/publish', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { platforms, scheduled_at } = req.body;

    if (!platforms || !Array.isArray(platforms)) {
      return res.status(400).json({ error: 'platforms array is required' });
    }

    // Update editions status to ready
    for (const platform of platforms) {
      await db.query(
        `UPDATE editions SET status = 'ready' 
         WHERE production_id = $1 AND platform = $2`,
        [id, platform]
      );

      // Create publication
      await db.query(
        `INSERT INTO publications (edition_id, platform, status, scheduled_at)
         SELECT id, $2, 'scheduled', $3
         FROM editions
         WHERE production_id = $1 AND platform = $2`,
        [id, platform, scheduled_at || null]
      );
    }

    res.json({ 
      status: 'scheduled', 
      message: `Production scheduled for publishing to ${platforms.join(', ')}` 
    });

  } catch (error) {
    console.error('Error publishing production:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
