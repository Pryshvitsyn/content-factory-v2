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
    
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async render(options) {
    const { images, audio, format = 'mp4', resolution = '1080x1920' } = options;
    
    console.log('[VideoRenderer] Starting render...');
    
    const timestamp = Date.now();
    
    // Save image to temp file (as PNG)
    const imagePath = path.join(this.tempDir, `image_${timestamp}.png`);
    fs.writeFileSync(imagePath, images[0]);
    
    // Save audio to temp file
    const audioPath = path.join(this.tempDir, `audio_${timestamp}.mp3`);
    fs.writeFileSync(audioPath, audio);
    
    // Output video path
    const outputPath = path.join(this.tempDir, `video_${timestamp}.${format}`);
    
    // Use -t 10 seconds as default
    const duration = 10;
    
    // FFmpeg command
    const ffmpegCommand = `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -t ${duration} -vf "scale=${resolution.replace('x', ':')}" "${outputPath}" 2>&1`;
    
    console.log('[VideoRenderer] Running FFmpeg...');
    console.log('[VideoRenderer] Command:', ffmpegCommand);
    
    // Execute FFmpeg
    await new Promise((resolve, reject) => {
      exec(ffmpegCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          console.error('[VideoRenderer] FFmpeg error:', error.message);
          console.error('[VideoRenderer] stderr:', stderr);
          reject(error);
          return;
        }
        console.log('[VideoRenderer] FFmpeg complete');
        resolve();
      });
    });
    
    // Read video file
    const videoBuffer = fs.readFileSync(outputPath);
    
    console.log('[VideoRenderer] Video size:', videoBuffer.length, 'bytes');
    
    // Cleanup temp files
    try {
      fs.unlinkSync(imagePath);
      fs.unlinkSync(audioPath);
      fs.unlinkSync(outputPath);
    } catch (e) {
      console.warn('[VideoRenderer] Cleanup warning:', e.message);
    }
    
    console.log('[VideoRenderer] Render complete');
    
    return videoBuffer;
  }
}

module.exports = { VideoRenderer };
