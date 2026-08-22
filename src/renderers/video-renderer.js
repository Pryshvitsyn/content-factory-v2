/**
 * Video Renderer
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class VideoRenderer {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
      const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath];
      const ffprobe = spawn('ffprobe', args);
      
      let duration = '';
      ffprobe.stdout.on('data', (data) => {
        duration += data.toString().trim();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0 && duration) {
          resolve(parseFloat(duration));
        } else {
          reject(new Error('Failed to get audio duration'));
        }
      });
      
      ffprobe.on('error', (err) => {
        reject(err);
      });
    });
  }

  async render(options) {
    const { images, audio, format = 'mp4', resolution = '1080x1920' } = options;
    
    console.log('[VideoRenderer] Starting render...');
    
    const timestamp = Date.now();
    const imagePath = path.join(this.tempDir, `image_${timestamp}.png`);
    fs.writeFileSync(imagePath, images[0]);
    
    const audioPath = path.join(this.tempDir, `audio_${timestamp}.mp3`);
    fs.writeFileSync(audioPath, audio);
    
    const outputPath = path.join(this.tempDir, `video_${timestamp}.${format}`);
    
    const duration = await this.getAudioDuration(audioPath);
    console.log('[VideoRenderer] Audio duration:', duration, 'seconds');
    
    const args = [
      '-y',
      '-nostdin',
      '-loop', '1',
      '-i', imagePath,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-t', duration.toString(),
      '-vf', `scale=${resolution.replace('x', ':')}`,
      outputPath
    ];
    
    console.log('[VideoRenderer] Running FFmpeg...');
    
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      
      ffmpeg.stdout.on('data', (data) => {
        console.log(`[FFmpeg] ${data}`);
      });
      
      ffmpeg.stderr.on('data', (data) => {
        const line = data.toString();
        if (line.includes('Stream #') || line.includes('Output #')) {
          console.log(`[FFmpeg] ${line.trim()}`);
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('[VideoRenderer] FFmpeg complete');
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });
    
    const videoBuffer = fs.readFileSync(outputPath);
    console.log('[VideoRenderer] Video size:', videoBuffer.length, 'bytes');
    
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
