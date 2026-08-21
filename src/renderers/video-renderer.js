/**
 * Video Renderer
 * 
 * Renders video from images and audio using FFmpeg
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class VideoRenderer {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async render(options) {
    const { images, audio, format = 'mp4', resolution = '1080x1920' } = options;
    
    console.log('[VideoRenderer] Starting render...');
    
    // Save image to temp file
    const imagePath = path.join(this.tempDir, `image_${Date.now()}.jpg`);
    fs.writeFileSync(imagePath, images[0]);
    
    // Save audio to temp file
    const audioPath = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    fs.writeFileSync(audioPath, audio);
    
    // Output video path
    const outputPath = path.join(this.tempDir, `video_${Date.now()}.${format}`);
    
    // FFmpeg command
    const ffmpegCommand = `
      ffmpeg -y 
      -loop 1 -i "${imagePath}" 
      -i "${audioPath}" 
      -c:v libx264 
      -tune stillimage 
      -c:a aac 
      -b:a 192k 
      -pix_fmt yuv420p 
      -shortest 
      -vf "scale=${resolution.replace('x', ':')}" 
      "${outputPath}"
    `.trim().replace(/\s+/g, ' ');
    
    console.log('[VideoRenderer] Running FFmpeg...');
    
    // Execute FFmpeg
    await new Promise((resolve, reject) => {
      exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('[VideoRenderer] FFmpeg error:', error.message);
          reject(error);
          return;
        }
        console.log('[VideoRenderer] FFmpeg output:', stderr);
        resolve();
      });
    });
    
    // Read video file
    const videoBuffer = fs.readFileSync(outputPath);
    
    // Cleanup temp files
    fs.unlinkSync(imagePath);
    fs.unlinkSync(audioPath);
    fs.unlinkSync(outputPath);
    
    console.log('[VideoRenderer] Render complete');
    
    return videoBuffer;
  }
}

module.exports = { VideoRenderer };
