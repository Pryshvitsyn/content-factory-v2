/**
 * Video Factory
 * 
 * End-to-end video generation pipeline
 */

const { ContentProvider } = require('../providers/nvidia-adapter');
const { VideoRenderer } = require('../renderers/video-renderer');
const { StorageManager } = require('../services/storage');
const { QualityGate } = require('../governance/quality-gate');
const { BudgetGovernance } = require('../governance/budget-governance');

class VideoFactory {
  constructor() {
    this.provider = new ContentProvider();
    this.renderer = new VideoRenderer();
    this.storage = new StorageManager();
    this.quality = new QualityGate();
    this.budget = new BudgetGovernance();
  }

  async create(request) {
    const { topic, style, duration, format, lang } = request;
    
    console.log('[VideoFactory] Starting video generation...');
    
    // Step 1: Generate script
    console.log('[VideoFactory] Step 1/4: Generating script...');
    const scriptResult = await this.provider.generate({
      type: 'text',
      input: {
        prompt: `Create a ${duration}-second ${style} style video script about: ${topic}. Format for TikTok/Reels.`,
        maxTokens: 500
      }
    });
    const script = scriptResult.content;
    console.log('[VideoFactory] Script generated:', script.substring(0, 100) + '...');
    
    // Step 2: Generate images
    console.log('[VideoFactory] Step 2/4: Generating images...');
    const imageResult = await this.provider.generate({
      type: 'image',
      input: { prompt: `${topic} ${style}` }
    });
    console.log('[VideoFactory] Images generated, provider:', imageResult.provider);
    
    // Step 3: Generate audio
    console.log('[VideoFactory] Step 3/4: Generating audio...');
    const audioResult = await this.provider.generate({
      type: 'audio',
      input: { text: script, lang }
    });
    console.log('[VideoFactory] Audio generated, provider:', audioResult.provider);
    
    // Step 4: Render video
    console.log('[VideoFactory] Step 4/4: Rendering video...');
    const videoBuffer = await this.renderer.render({
      images: [imageResult.imageData],
      audio: audioResult.audioData,
      format: 'mp4',
      resolution: '1080x1920'
    });
    console.log('[VideoFactory] Video rendered, size:', videoBuffer.length, 'bytes');
    
    // Step 5: Quality check
    console.log('[VideoFactory] Running quality checks...');
    const qualityCheck = await this.quality.validate({
      type: 'video',
      data: videoBuffer,
      metadata: { duration: audioResult.duration, format: 'mp4', resolution: '1080x1920' }
    });
    console.log('[VideoFactory] Quality check passed:', qualityCheck.passed);
    
    // Step 6: Store video
    console.log('[VideoFactory] Storing video...');
    const videoId = `video_${Date.now()}`;
    await this.storage.save({
      id: videoId,
      type: 'video',
      data: videoBuffer,
      metadata: { topic, style, duration, format, lang, script, qualityCheck }
    });
    console.log('[VideoFactory] Video stored');
    
    // Step 7: Budget tracking
    await this.budget.track({
      type: 'video',
      cost: 0.05,
      metadata: { videoId, topic, style }
    });
    
    return {
      videoId,
      status: 'ready',
      storagePath: `/videos/${videoId}.mp4`,
      publicUrl: `https://storage.contentfactory.ai/videos/${videoId}.mp4`,
      metadata: {
        duration: audioResult.duration,
        format: 'mp4',
        resolution: '1080x1920',
        qualityCheck
      }
    };
  }
}

module.exports = { VideoFactory };
