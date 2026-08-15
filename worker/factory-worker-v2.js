const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Load contracts
const ProductionContract = require('./v2.1-production-contract');
const Contracts = require('./v2.1-contracts');

// Load engines
const DbContextLoader = require('./v2.1-db-context-loader');
const ContextResolver = require('./v2.1-context-resolver');
const BibleEngine = require('./v2.1-bible-engine');
const BibleValidator = require('./v2.1-bible-validator');
const ProductionBoundary = require('./v2.1-production-boundary');

/**
 * V2.1 Factory Worker
 * 
 * Multi-tenant content production worker that:
 * - Claims jobs from database
 * - Loads business/brand/series context
 * - Resolves inheritance rules
 * - Generates production bibles
 * - Executes generation stages (script, shots, assets, video)
 * - Uses NVIDIA Nemotron API for AI generation
 * - Validates continuity and compliance
 * - Updates job status
 */
class FactoryWorker {
  constructor(config) {
    this.config = config;
    this.workerId = config.workerId || `worker-${uuidv4().slice(0, 8)}`;
    this.db = new Pool({ connectionString: config.databaseUrl });
    this.nvidiaApiKey = config.nvidiaApiKey;
    this.nvidiaBaseUrl = config.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1';
    
    console.log(`[Worker] Starting ${this.workerId}...`);
  }

  /**
   * Start worker loop
   */
  async start() {
    console.log(`[Worker] ${this.workerId} started. Listening for jobs...`);
    
    while (true) {
      try {
        // Claim next available job
        const job = await this.claimNextJob();
        
        if (!job) {
          // No jobs available, wait 5 seconds
          await this.sleep(5000);
          continue;
        }
        
        console.log(`[Worker] ${this.workerId} claimed job ${job.id} (${job.job_type})`);
        
        // Execute job
        await this.executeJob(job);
        
      } catch (error) {
        console.error(`[Worker] ${this.workerId} error:`, error);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Claim next available job
   * @returns {Promise<Object|null>} Job or null
   */
  async claimNextJob() {
    const result = await this.db.query(
      `UPDATE jobs
       SET status = 'running', started_at = NOW(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued'
         AND (dependencies = '{}' OR 
              EXISTS (
                SELECT 1 FROM unnest(dependencies) dep
                JOIN jobs j2 ON j2.id = dep
                WHERE j2.status = 'completed'
              ))
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      []
    );
    
    return result.rows[0] || null;
  }

  /**
   * Execute job based on type
   * @param {Object} job - Job object
   */
  async executeJob(job) {
    try {
      // Load production context
      const context = await DbContextLoader.loadProductionContext(this.db, job.production_id);
      
      if (!context) {
        throw new Error(`Production ${job.production_id} not found`);
      }
      
      // Resolve inheritance (business → brand → series → production)
      const resolvedContext = ContextResolver.resolve(context);
      
      // Generate production bible
      const bible = BibleEngine.generate(resolvedContext);
      
      // Validate bible
      const validation = BibleValidator.validate(bible);
      if (!validation.passed) {
        throw new Error(`Bible validation failed: ${validation.issues.join(', ')}`);
      }
      
      // Enforce production boundaries
      ProductionBoundary.enforce(bible);
      
      // Execute job based on type
      switch (job.job_type) {
        case 'SCRIPT_GENERATION':
          await this.generateScript(job, bible);
          break;
          
        case 'SHOT_GENERATION':
          await this.generateShot(job, bible);
          break;
          
        case 'ASSET_GENERATION':
          await this.generateAsset(job, bible);
          break;
          
        case 'CONTINUITY_CHECK':
          await this.validateContinuity(job, bible);
          break;
          
        case 'COMPLIANCE_CHECK':
          await this.validateCompliance(job, bible);
          break;
          
        case 'RENDER_VIDEO':
          await this.renderVideo(job, bible);
          break;
          
        case 'PUBLISH':
          await this.publish(job, bible);
          break;
          
        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }
      
      // Mark job as completed
      await this.completeJob(job.id);
      
    } catch (error) {
      console.error(`[Worker] Job ${job.id} failed:`, error);
      await this.failJob(job.id, error.message);
    }
  }

  /**
   * Generate script using NVIDIA Nemotron
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async generateScript(job, bible) {
    console.log(`[Worker] ${this.workerId} generating script for production ${job.production_id}`);
    
    // Build prompt from bible
    const prompt = this.buildScriptPrompt(bible);
    
    // Call NVIDIA Nemotron API
    const response = await fetch(`${this.nvidiaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.nvidiaApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'nemotron-405b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });
    
    if (!response.ok) {
      throw new Error(`NVIDIA API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const script = data.choices[0].message.content;
    
    // Save script as artifact
    await this.saveArtifact({
      artifact_type: 'SCRIPT',
      production_id: job.production_id,
      provider: 'nvidia',
      model: 'nemotron-405b',
      prompt: prompt,
      storage_uri: `s3://factory/scripts/${job.production_id}.json`,
      metadata: { script }
    });
    
    console.log(`[Worker] ${this.workerId} script generated for production ${job.production_id}`);
  }

  /**
   * Generate shot using NVIDIA
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async generateShot(job, bible) {
    console.log(`[Worker] ${this.workerId} generating shot for production ${job.production_id}`);
    
    // TODO: Implement shot generation using NVIDIA video models
    // For now, mark as completed
  }

  /**
   * Generate asset (character, location, voice) using NVIDIA
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async generateAsset(job, bible) {
    console.log(`[Worker] ${this.workerId} generating asset for production ${job.production_id}`);
    
    // TODO: Implement asset generation using NVIDIA image/voice models
    // For now, mark as completed
  }

  /**
   * Validate continuity
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async validateContinuity(job, bible) {
    console.log(`[Worker] ${this.workerId} validating continuity for production ${job.production_id}`);
    
    // TODO: Implement continuity validation
    // For now, mark as completed
  }

  /**
   * Validate compliance
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async validateCompliance(job, bible) {
    console.log(`[Worker] ${this.workerId} validating compliance for production ${job.production_id}`);
    
    // TODO: Implement compliance validation against brand rules
    // For now, mark as completed
  }

  /**
   * Render video
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async renderVideo(job, bible) {
    console.log(`[Worker] ${this.workerId} rendering video for production ${job.production_id}`);
    
    // TODO: Implement video rendering from shots and assets
    // For now, mark as completed
  }

  /**
   * Publish to platforms
   * @param {Object} job - Job object
   * @param {Object} bible - Production bible
   */
  async publish(job, bible) {
    console.log(`[Worker] ${this.workerId} publishing production ${job.production_id}`);
    
    // TODO: Implement publishing to TikTok, Instagram, YouTube
    // For now, mark as completed
  }

  /**
   * Build script prompt from bible
   * @param {Object} bible - Production bible
   * @returns {string} Prompt
   */
  buildScriptPrompt(bible) {
    return `Generate a ${bible.format_rules.duration_ms / 1000}-second video script.

Brand Tone: ${bible.brand_rules.tone}
Visual Style: ${bible.visual_rules.style}
Topic: ${bible.topic}
Hook Style: ${bible.format_rules.hook_style}
CTA: ${bible.format_rules.cta}

Generate a script with:
- Attention-grabbing hook (first 3 seconds)
- Clear value proposition
- Strong call-to-action

Format as JSON with fields: hook, body, cta`;
  }

  /**
   * Save artifact to database
   * @param {Object} artifact - Artifact object
   */
  async saveArtifact(artifact) {
    const result = await this.db.query(
      `INSERT INTO artifacts (
        artifact_type, production_id, provider, model, prompt,
        storage_uri, metadata, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')
      RETURNING *`,
      [
        artifact.artifact_type,
        artifact.production_id,
        artifact.provider,
        artifact.model,
        artifact.prompt,
        artifact.storage_uri,
        JSON.stringify(artifact.metadata)
      ]
    );
    
    return result.rows[0];
  }

  /**
   * Complete job
   * @param {string} jobId - Job UUID
   */
  async completeJob(jobId) {
    await this.db.query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId]
    );
    
    console.log(`[Worker] ${this.workerId} completed job ${jobId}`);
  }

  /**
   * Fail job
   * @param {string} jobId - Job UUID
   * @param {string} error - Error message
   */
  async failJob(jobId, error) {
    await this.db.query(
      `UPDATE jobs SET status = 'failed', failed_at = NOW() WHERE id = $1`,
      [jobId]
    );
    
    console.error(`[Worker] ${this.workerId} failed job ${jobId}: ${error}`);
  }

  /**
   * Sleep for milliseconds
   * @param {number} ms - Milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start worker if run directly
if (require.main === module) {
  const config = {
    workerId: process.env.WORKER_ID,
    databaseUrl: process.env.DATABASE_URL,
    nvidiaApiKey: process.env.NVIDIA_API_KEY,
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL
  };
  
  const worker = new FactoryWorker(config);
  worker.start();
}

module.exports = { FactoryWorker };
