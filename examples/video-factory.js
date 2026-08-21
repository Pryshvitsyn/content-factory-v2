/**
 * Video Factory Example
 * 
 * Demonstrates end-to-end video generation using the VideoFactory class
 * Uses NVIDIA API for text/audio and Unsplash for images
 */

const { VideoFactory } = require('../src/factories/video-factory');

async function main() {
  console.log('🎬 Starting Video Factory...\n');
  
  const factory = new VideoFactory();
  
  const request = {
    topic: 'AI is changing how we create content',
    style: 'tech',
    duration: 30,
    format: 'tiktok',
    lang: 'en'
  };
  
  console.log('📝 Request:', JSON.stringify(request, null, 2));
  console.log('\n🚀 Generating video...\n');
  
  try {
    const result = await factory.create(request);
    
    console.log('\n✅ Video generated successfully!');
    console.log('\n📊 Result:', JSON.stringify({
      videoId: result.videoId,
      status: result.status,
      storagePath: result.storagePath,
      publicUrl: result.publicUrl,
      metadata: {
        duration: result.metadata?.duration,
        format: result.metadata?.format,
        resolution: result.metadata?.resolution
      }
    }, null, 2));
    
    console.log('\n🎬 Video ready!');
    
  } catch (error) {
    console.error('\n❌ Error generating video:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
