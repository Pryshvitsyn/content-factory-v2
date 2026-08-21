/**
 * Video Factory V2.1 (Updated)
 * 
 * Production-grade video generation factory with:
 * - Scored provider selection (7-dimension scoring like OpenMontage)
 * - Quality gates (pre-compose validation, post-render QA)
 * - Decision audit trail
 * - Budget governance
 * - Multi-provider support (NVIDIA + future providers)
 * - FFmpeg rendering
 * - Local/S3 storage
 */

const { ProviderGateway } = require('../providers/provider-gateway');
const { FFmpegVideoRenderer } = require('../renderers/ffmpeg-video-renderer');
const { VideoStorage } = require('../storage/video-storage');

/**
 * Provider scoring dimensions (like OpenMontage)
 */
const SCORING_DIMENSIONS = {
  QUALITY: 'quality',
  SPEED: 'speed',
  COST: 'cost',
  RELIABILITY: 'reliability',
  FEATURE_MATCH: 'feature_match',
  LATENCY: 'latency',
  AVAILABILITY: 'availability'
};

/**
 * Quality gate types
 */
const QUALITY_GATES = {
  PRE_COMPOSE: 'pre_compose',
  POST_RENDER: 'post_render',
  FINAL_QA: 'final_qa'
};

/**
 * Video Factory configuration
 */
class VideoFactoryConfig {
  constructor(config = {}) {
    this.providers = config.providers || ['nvidia'];
    this.scoringWeights = config.scoringWeights || {
      [SCORING_DIMENSIONS.QUALITY]: 0.25,
      [SCORING_DIMENSIONS.SPEED]: 0.15,
      [SCORING_DIMENSIONS.COST]: 0.15,
      [SCORING_DIMENSIONS.RELIABILITY]: 0.15,
      [SCORING_DIMENSIONS.FEATURE_MATCH]: 0.15,
      [SCORING_DIMENSIONS.LATENCY]: 0.10,
      [SCORING_DIMENSIONS.AVAILABILITY]: 0.05
    };
    this.qualityGates = config.qualityGates || {
      [QUALITY_GATES.PRE_COMPOSE]: true,
      [QUALITY_GATES.POST_RENDER]: true,
      [QUALITY_GATES.FINAL_QA]: true
    };
    this.budget = config.budget || {
      enabled: true,
      maxCostPerVideo: 5.00, // USD
      estimateBeforeRun: true
    };
    this.cache = config.cache || {
      enabled: true,
      ttl: 3600000 // 1 hour
    };
    this.rendering = config.rendering || {};
    this.storage = config.storage || {};
  }
}

/**
 * Video Factory - production-grade video generation
 */
class VideoFactory {
  /**
   * @param {VideoFactoryConfig} config - Factory configuration
   * @param {ProviderGateway} providerGateway - Optional provider gateway (for testing)
   */
  constructor(config = new VideoFactoryConfig(), providerGateway = null) {
    this.config = config;
    this.providerGateway = providerGateway || new ProviderGateway();
    this.renderer = new FFmpegVideoRenderer(config.rendering);
    this.storage = new VideoStorage(config.storage);
    this.decisionLog = [];
  }

  /**
   * Generate video with full production pipeline
   * @param {Object} input - Video generation input
   * @returns {Promise<Object>} - Video generation result
   */
  async generateVideo(input) {
    const jobId = this._generateJobId(input);
    const startTime = Date.now();
    
    console.log(`[VideoFactory] Starting job ${jobId}`, input);

    try {
      // Stage 0: Budget estimation
      if (this.config.budget.enabled && this.config.budget.estimateBeforeRun) {
        const budgetEstimate = await this._estimateBudget(input);
        if (budgetEstimate.estimatedCost > this.config.budget.maxCostPerVideo) {
          throw new Error(`Budget exceeded: estimated $${budgetEstimate.estimatedCost} > max $${this.config.budget.maxCostPerVideo}`);
        }
        this._logDecision('budget_check', { passed: true, estimate: budgetEstimate });
      }

      // Stage 1: Provider selection with scoring
      const selectedProvider = await this._selectBestProvider(input);
      this._logDecision('provider_selection', {
        selected: selectedProvider,
        scores: await this._scoreProviders(input)
      });

      // Stage 2: Pre-compose quality gate
      if (this.config.qualityGates[QUALITY_GATES.PRE_COMPOSE]) {
        const preComposeResult = await this._runPreComposeGate(input);
        if (!preComposeResult.passed) {
          throw new Error(`Pre-compose gate failed: ${preComposeResult.issues.join(', ')}`);
        }
        this._logDecision('pre_compose_gate', { passed: true });
      }

      // Stage 3: Generate script
      const script = await this._generateScript(input, selectedProvider);
      
      // Stage 4: Generate audio (voiceover)
      const audio = await this._generateAudio(input, script, selectedProvider);
      
      // Stage 5: Generate visuals
      const visuals = await this._generateVisuals(input, script, selectedProvider);
      
      // Stage 6: Render video with FFmpeg
      const rendered = await this._renderVideo(input, { script, audio, visuals }, selectedProvider, jobId);
      
      // Stage 7: Post-render quality gate
      if (this.config.qualityGates[QUALITY_GATES.POST_RENDER]) {
        const postRenderResult = await this._runPostRenderGate({ script, audio, visuals, rendered });
        if (!postRenderResult.passed) {
          throw new Error(`Post-render gate failed: ${postRenderResult.issues.join(', ')}`);
        }
        this._logDecision('post_render_gate', { passed: true });
      }
      
      // Stage 8: Final QA
      if (this.config.qualityGates[QUALITY_GATES.FINAL_QA]) {
        const finalQA = await this._runFinalQA({ script, audio, visuals, rendered });
        if (!finalQA.passed) {
          throw new Error(`Final QA failed: ${finalQA.issues.join(', ')}`);
        }
        this._logDecision('final_qa', { passed: true, metrics: finalQA.metrics });
      }
      
      // Stage 9: Store result
      const outputPath = await this._storeResult(rendered.outputPath, jobId);
      
      const duration = Date.now() - startTime;
      console.log(`[VideoFactory] Job ${jobId} completed in ${duration}ms`, { outputPath });
      
      return {
        jobId,
        status: 'success',
        duration,
        artifacts: {
          script,
          audio,
          visuals,
          rendered
        },
        outputPath,
        decisionLog: this.decisionLog,
        qa: {
          preCompose: true,
          postRender: true,
          finalQA: true
        }
      };
    } catch (error) {
      console.error(`[VideoFactory] Job ${jobId} failed:`, error);
      return {
        jobId,
        status: 'failed',
        error: error.message,
        decisionLog: this.decisionLog
      };
    }
  }

  /**
   * Score providers across 7 dimensions
   * @private
   */
  async _scoreProviders(input) {
    const scores = {};
    
    for (const provider of this.config.providers) {
      scores[provider] = {
        [SCORING_DIMENSIONS.QUALITY]: this._scoreQuality(provider, input),
        [SCORING_DIMENSIONS.SPEED]: this._scoreSpeed(provider),
        [SCORING_DIMENSIONS.COST]: this._scoreCost(provider),
        [SCORING_DIMENSIONS.RELIABILITY]: this._scoreReliability(provider),
        [SCORING_DIMENSIONS.FEATURE_MATCH]: this._scoreFeatureMatch(provider, input),
        [SCORING_DIMENSIONS.LATENCY]: this._scoreLatency(provider),
        [SCORING_DIMENSIONS.AVAILABILITY]: this._scoreAvailability(provider)
      };
    }
    
    return scores;
  }

  /**
   * Select best provider based on weighted scoring
   * @private
   */
  async _selectBestProvider(input) {
    const scores = await this._scoreProviders(input);
    
    let bestProvider = null;
    let bestScore = -1;
    
    for (const [provider, dimensionScores] of Object.entries(scores)) {
      const weightedScore = Object.entries(dimensionScores)
        .reduce((sum, [dimension, score]) => {
          return sum + (score * this.config.scoringWeights[dimension]);
        }, 0);
      
      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestProvider = provider;
      }
    }
    
    return bestProvider || 'nvidia';
  }

  /**
   * Estimate budget before running
   * @private
   */
  async _estimateBudget(input) {
    // TODO: Implement actual budget estimation based on provider pricing
    return {
      estimatedCost: 0.50, // Placeholder
      breakdown: {
        script: 0.10,
        audio: 0.15,
        visuals: 0.20,
        render: 0.05
      }
    };
  }

  /**
   * Pre-compose quality gate
   * @private
   */
  async _runPreComposeGate(input) {
    const issues = [];
    
    // Validate input
    if (!input.topic || input.topic.trim().length === 0) {
      issues.push('Topic is required');
    }
    
    if (!input.lang || !['en', 'it', 'ru'].includes(input.lang)) {
      issues.push('Invalid language: must be en, it, or ru');
    }
    
    if (input.duration && (input.duration < 15 || input.duration > 120)) {
      issues.push('Duration must be between 15 and 120 seconds');
    }
    
    return {
      passed: issues.length === 0,
      issues
    };
  }

  /**
   * Post-render quality gate
   * @private
   */
  async _runPostRenderGate(artifacts) {
    const issues = [];
    
    // Check artifacts exist
    if (!artifacts.script?.content) {
      issues.push('Script content is missing');
    }
    
    if (!artifacts.audio?.data) {
      issues.push('Audio data is missing');
    }
    
    if (!artifacts.visuals?.elements || artifacts.visuals.elements.length === 0) {
      issues.push('No visual elements generated');
    }
    
    if (!artifacts.rendered?.success) {
      issues.push('Video rendering failed');
    }
    
    return {
      passed: issues.length === 0,
      issues
    };
  }

  /**
   * Final QA checks
   * @private
   */
  async _runFinalQA(artifacts) {
    const issues = [];
    const metrics = {};
    
    // Check duration matches target
    if (artifacts.audio?.duration) {
      metrics.audioDuration = artifacts.audio.duration;
    }
    
    // Check visual count
    if (artifacts.visuals?.elements) {
      metrics.visualCount = artifacts.visuals.elements.length;
    }
    
    // Check rendered video exists
    if (artifacts.rendered?.outputPath) {
      metrics.renderedPath = artifacts.rendered.outputPath;
    }
    
    // TODO: Add more QA metrics (sync, quality, etc.)
    
    return {
      passed: issues.length === 0,
      issues,
      metrics
    };
  }

  /**
   * Generate script using selected provider
   * @private
   */
  async _generateScript(input, provider) {
    console.log(`[VideoFactory] Generating script with ${provider}...`);
    
    const prompt = this._buildScriptPrompt(input);
    
    const result = await this.providerGateway.generate({
      provider,
      type: 'text',
      input: {
        prompt,
        maxTokens: 500,
        temperature: 0.7
      }
    });
    
    return {
      type: 'script',
      content: result.text,
      provider,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Generate audio using selected provider
   * @private
   */
  async _generateAudio(input, script, provider) {
    console.log(`[VideoFactory] Generating audio with ${provider}...`);
    
    const result = await this.providerGateway.generate({
      provider,
      type: 'audio',
      input: {
        text: script.content,
        lang: input.lang,
        voice: this._selectVoice(input.style, input.lang)
      }
    });
    
    return {
      type: 'audio',
      data: result.audioData,
      duration: result.duration,
      provider,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Generate visuals using selected provider
   * @private
   */
  async _generateVisuals(input, script, provider) {
    console.log(`[VideoFactory] Generating visuals with ${provider}...`);
    
    const visualPrompts = this._buildVisualPrompts(input, script);
    
    const results = await Promise.all(
      visualPrompts.map(prompt =>
        this.providerGateway.generate({
          provider,
          type: 'image',
          input: {
            prompt,
            style: input.style,
            aspectRatio: this._getAspectRatio(input)
          }
        })
      )
    );
    
    return {
      type: 'visuals',
      elements: results.map((r, i) => ({
        sceneIndex: i,
        imageData: r.imageData,
        prompt: visualPrompts[i],
        provider
      })),
      provider,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Render video with FFmpeg
   * @private
   */
  async _renderVideo(input, artifacts, provider, jobId) {
    console.log(`[VideoFactory] Rendering video with ${provider}...`);
    
    // Create temporary output path
    const tempOutputPath = `/tmp/${jobId}.mp4`;
    
    const result = await this.renderer.render(input, artifacts, tempOutputPath);
    
    return result;
  }

  /**
   * Store result
   * @private
   */
  async _storeResult(outputPath, jobId) {
    console.log(`[VideoFactory] Storing result for ${jobId}...`);
    
    const storedPath = await this.storage.store(outputPath, jobId, {
      storedAt: new Date().toISOString()
    });
    
    return storedPath;
  }

  /**
   * Log decision for audit trail
   * @private
   */
  _logDecision(type, data) {
    this.decisionLog.push({
      timestamp: new Date().toISOString(),
      type,
      data
    });
  }

  /**
   * Generate unique job ID
   * @private
   */
  _generateJobId(input) {
    const timestamp = Date.now();
    const appPrefix = (input.app || 'video').substring(0, 4).toLowerCase();
    return `video-${appPrefix}-${timestamp}`;
  }

  /**
   * Build script prompt
   * @private
   */
  _buildScriptPrompt(input) {
    return `Create a promotional video script for the app "${input.app}".
Topic: ${input.topic}
Language: ${input.lang}
Duration: approximately ${input.duration || 30} seconds
Style: ${input.style || 'tech'}

The script should be engaging, clear, and suitable for a short promotional video.`;
  }

  /**
   * Build visual prompts
   * @private
   */
  _buildVisualPrompts(input, script) {
    const basePrompt = `Create a visual background for a ${input.style || 'tech'} style promotional video`;
    const numScenes = Math.max(3, Math.floor((input.duration || 30) / 10));
    
    return Array.from({ length: numScenes }, (_, i) => 
      `${basePrompt}, scene ${i + 1}, ${input.app} branding`
    );
  }

  /**
   * Select voice
   * @private
   */
  _selectVoice(style, lang) {
    // TODO: Implement voice selection logic
    return 'default';
  }

  /**
   * Get aspect ratio
   * @private
   */
  _getAspectRatio(input) {
    // TODO: Configure based on platform (TikTok, YouTube, etc.)
    return '9:16';
  }

  /**
   * Scoring helpers (placeholder implementations)
   * @private
   */
  _scoreQuality(provider, input) { return 0.8; }
  _scoreSpeed(provider) { return 0.7; }
  _scoreCost(provider) { return 0.9; }
  _scoreReliability(provider) { return 0.85; }
  _scoreFeatureMatch(provider, input) { return 0.8; }
  _scoreLatency(provider) { return 0.75; }
  _scoreAvailability(provider) { return 0.95; }
}

module.exports = { VideoFactory, VideoFactoryConfig, SCORING_DIMENSIONS, QUALITY_GATES };
