/**
 * V2.1 Production Contract
 * 
 * Defines the structure for production entities in the multi-tenant content factory.
 * This contract ensures type safety and consistency across the factory system.
 */

/**
 * @typedef {Object} Production
 * @property {string} id - Production UUID
 * @property {string} content_variant_id - Content variant UUID
 * @property {string} universe_id - Content universe/series UUID
 * @property {string} title - Production title
 * @property {ProductionBible} production_bible - Production bible with creative rules
 * @property {'queued' | 'in_progress' | 'completed' | 'failed'} status - Production status
 * @property {string} created_at - ISO timestamp
 * @property {string} updated_at - ISO timestamp
 */

/**
 * @typedef {Object} ProductionBible
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
 */

/**
 * @typedef {Object} BrandRules
 * @property {string} tone - Brand tone (e.g., 'funny', 'trustworthy')
 * @property {string} visual_language - Visual style description
 * @property {Array<string>} forbidden - Prohibited content/claims
 * @property {Array<string>} required - Required elements/disclaimers
 */

/**
 * @typedef {Object} VisualRules
 * @property {string} style - Visual style (e.g., 'warm_cinematic')
 * @property {string} color_palette - Color scheme
 * @property {string} composition - Composition rules
 */

/**
 * @typedef {Object} CameraRules
 * @property {string} movement - Camera movement style
 * @property {string} angles - Preferred camera angles
 * @property {string} focus - Focus style
 */

/**
 * @typedef {Object} LightingRules
 * @property {string} type - Lighting type (e.g., 'natural', 'studio')
 * @property {string} mood - Lighting mood
 * @property {string} direction - Light direction
 */

/**
 * @typedef {Object} ContinuityRules
 * @property {string} character_identity - Character consistency requirements
 * @property {string} wardrobe - Wardrobe consistency
 * @property {string} location - Location consistency
 * @property {string} props - Prop consistency
 */

/**
 * @typedef {Object} Shot
 * @property {string} id - Shot UUID
 * @property {string} production_id - Production UUID
 * @property {number} shot_number - Shot sequence number
 * @property {number} duration_ms - Shot duration in milliseconds
 * @property {Array<string>} characters - Character UUIDs in this shot
 * @property {string} location - Location UUID
 * @property {string} action - Action description
 * @property {string} camera - Camera direction
 * @property {string} dialogue - Character dialogue
 * @property {string} visual_style - Visual style for this shot
 * @property {Array<string>} required_assets - Required asset UUIDs
 * @property {'pending' | 'generating' | 'completed' | 'failed'} status - Shot status
 */

/**
 * @typedef {Object} Artifact
 * @property {string} id - Artifact UUID
 * @property {'SCRIPT' | 'REFERENCE_IMAGE' | 'IMAGE' | 'VIDEO' | 'VOICE' | 'AUDIO' | 'MUSIC' | 'CAPTIONS' | 'EDIT' | 'FINAL_VIDEO' | 'THUMBNAIL'} artifact_type - Type of artifact
 * @property {string} asset_id - Associated asset UUID
 * @property {string} production_id - Production UUID
 * @property {string} stage_run_id - Stage run UUID
 * @property {number} version - Artifact version number
 * @property {'pending' | 'generating' | 'completed' | 'failed'} status - Artifact status
 * @property {string} provider - AI provider (e.g., 'nvidia')
 * @property {string} model - Model used (e.g., 'nemotron-405b')
 * @property {string} prompt - Generation prompt
 * @property {string} input_hash - Hash of input for idempotency
 * @property {string} output_hash - Hash of output for idempotency
 * @property {string} storage_uri - Storage location (S3, etc.)
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} Job
 * @property {string} id - Job UUID
 * @property {string} production_id - Production UUID
 * @property {'SCRIPT_GENERATION' | 'SHOT_GENERATION' | 'ASSET_GENERATION' | 'CONTINUITY_CHECK' | 'COMPLIANCE_CHECK' | 'RENDER_VIDEO' | 'PUBLISH'} job_type - Type of job
 * @property {'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying'} status - Job status
 * @property {number} priority - Job priority (higher = more urgent)
 * @property {string} idempotency_key - Unique key for idempotency
 * @property {number} attempts - Number of retry attempts
 * @property {string} parent_job_id - Parent job UUID (for dependencies)
 * @property {Array<string>} dependencies - Dependency job UUIDs
 * @property {string} created_at - ISO timestamp
 * @property {string} started_at - ISO timestamp (when job started)
 * @property {string} completed_at - ISO timestamp (when job completed)
 * @property {string} failed_at - ISO timestamp (when job failed)
 * @property {string} cancelled_at - ISO timestamp (when job cancelled)
 */

/**
 * @typedef {Object} StageRun
 * @property {string} id - Stage run UUID
 * @property {string} job_id - Job UUID
 * @property {'SIGNAL' | 'IDEA' | 'BRIEF' | 'CONCEPT' | 'SCRIPT' | 'BIBLE' | 'ASSET_PLAN' | 'SHOT_PLAN' | 'ASSET_GENERATION' | 'CONTINUITY' | 'EDIT' | 'PLATFORM_ADAPTATION' | 'VALIDATION' | 'PUBLISH' | 'ANALYZE' | 'LEARN'} stage - Stage name
 * @property {'pending' | 'running' | 'completed' | 'failed'} status - Stage status
 * @property {Array<string>} input_artifacts - Input artifact UUIDs
 * @property {Array<string>} output_artifacts - Output artifact UUIDs
 * @property {string} provider - AI provider used
 * @property {string} model - Model used
 * @property {string} error - Error message (if failed)
 * @property {number} attempt - Attempt number
 * @property {string} created_at - ISO timestamp
 * @property {string} started_at - ISO timestamp
 * @property {string} completed_at - ISO timestamp
 * @property {string} failed_at - ISO timestamp
 */

/**
 * @typedef {Object} Edition
 * @property {string} id - Edition UUID
 * @property {string} production_id - Production UUID
 * @property {'tiktok' | 'instagram' | 'youtube' | 'youtube_short'} platform - Target platform
 * @property {'vertical_short' | 'reel' | 'short' | 'long_form'} edition_type - Edition type
 * @property {number} duration_ms - Edition duration in milliseconds
 * @property {'9:16' | '16:9' | '1:1' | '4:5'} aspect_ratio - Aspect ratio
 * @property {string} title - Edition title
 * @property {string} description - Edition description
 * @property {string} caption - Social media caption
 * @property {string} thumbnail_uri - Thumbnail image URL
 * @property {string} cta - Call-to-action
 * @property {Object} metadata - Additional metadata
 * @property {'draft' | 'ready' | 'published'} status - Edition status
 */

/**
 * @typedef {Object} Publication
 * @property {string} id - Publication UUID
 * @property {string} edition_id - Edition UUID
 * @property {'tiktok' | 'instagram' | 'youtube'} platform - Platform
 * @property {string} account - Account handle/username
 * @property {string} scheduled_at - Scheduled publication time (ISO)
 * @property {string} published_at - Actual publication time (ISO)
 * @property {string} external_id - Platform's publication ID
 * @property {'draft' | 'scheduled' | 'published' | 'failed'} status - Publication status
 * @property {Object} metadata - Platform-specific metadata
 */

/**
 * @typedef {Object} Metric
 * @property {string} id - Metric UUID
 * @property {string} publication_id - Publication UUID
 * @property {'engagement' | 'retention' | 'conversion'} metric_type - Metric category
 * @property {'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks' | 'watch_time' | 'avg_watch_time' | 'retention_rate'} metric_name - Specific metric
 * @property {number} metric_value - Metric value
 * @property {string} recorded_at - When metric was recorded (ISO)
 * @property {Object} metadata - Additional metadata
 */

module.exports = {
  validateProduction(production) {
    if (!production.id) return false;
    if (!production.content_variant_id) return false;
    if (!production.title) return false;
    if (!production.status) return false;
    return true;
  },

  validateShot(shot) {
    if (!shot.id) return false;
    if (!shot.production_id) return false;
    if (typeof shot.shot_number !== 'number') return false;
    if (typeof shot.duration_ms !== 'number') return false;
    if (!shot.action) return false;
    return true;
  },

  validateArtifact(artifact) {
    if (!artifact.id) return false;
    if (!artifact.artifact_type) return false;
    if (!artifact.production_id) return false;
    if (!artifact.status) return false;
    return true;
  },

  validateJob(job) {
    if (!job.id) return false;
    if (!job.production_id) return false;
    if (!job.job_type) return false;
    if (!job.status) return false;
    return true;
  }
};
