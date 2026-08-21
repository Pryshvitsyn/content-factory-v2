/**
 * FFmpeg Video Renderer (Improved)
 * 
 * Production-grade video renderer using FFmpeg
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class FFmpegVideoRenderer {
  constructor(config = {}) {
    this.config = {
      ffmpegPath: config.ffmpegPath || 'ffmpeg',
      outputFormat: config.outputFormat || 'mp4',
      framerate: config.framerate || 30,
      videoCodec: config.videoCodec || 'libx264',
      audioCodec: config.audioCodec || 'aac',
      videoBitrate: config.videoBitrate || '5000k',
      audioBitrate: config.audioBitrate || '128k',
      resolution: config.resolution || '1080x1920',
      ...config
    };
  }

  async render(input, artifacts, outputPath) {
    const startTime = Date.now();
    
    console.log('[FFmpegRenderer] Starting render...', { 
      input: { app: input.app, duration: input.duration, style: input.style },
      outputPath 
    });

    try {
      const tempDir = path.join(process.cwd(), 'temp', `render-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      // Save visual elements as images
      const imageFiles = await this._saveImages(artifacts.visuals, tempDir);
      console.log(`[FFmpegRenderer] Saved ${imageFiles.length} images`);
      
      // Save audio (voiceover)
      const audioFile = await this._saveAudio(artifacts.audio, tempDir);
      console.log(`[FFmpegRenderer] Saved audio: ${audioFile}`);
      
      // Calculate scene duration
      const sceneDuration = this._calculateSceneDuration(input, imageFiles.length);
      console.log(`[FFmpegRenderer] Scene duration: ${sceneDuration}s`);
      
      // Create FFmpeg command
      const ffmpegArgs = this._buildFFmpegCommand(
        input, 
        imageFiles, 
        audioFile, 
        outputPath,
        sceneDuration
      );
      
      // Execute FFmpeg
      console.log(`[FFmpegRenderer] Executing FFmpeg...`);
      await this._executeFFmpeg(ffmpegArgs);
      
      // Verify output file exists
      const outputExists = await this._fileExists(outputPath);
      if (!outputExists) {
        throw new Error('Output file was not created');
      }
      
      // Cleanup temp files
      await this._cleanup(tempDir);
      
      const duration = Date.now() - startTime;
      console.log(`[FFmpegRenderer] Render completed in ${duration}ms`, { outputPath });
      
      return {
        success: true,
        outputPath,
        duration,
        metadata: {
          format: this.config.outputFormat,
          framerate: this.config.framerate,
          resolution: this.config.resolution,
          sceneCount: imageFiles.length,
          sceneDuration
        }
      };
    } catch (error) {
      console.error('[FFmpegRenderer] Render failed:', error);
      throw error;
    }
  }

  async _saveImages(visuals, tempDir) {
    const imageFiles = [];
    
    for (let i = 0; i < visuals.elements.length; i++) {
      const element = visuals.elements[i];
      const imagePath = path.join(tempDir, `scene-${i}.png`);
      
      let imageData;
      if (typeof element.imageData === 'string') {
        if (element.imageData.startsWith('data:image')) {
          const base64Data = element.imageData.split(',')[1];
          imageData = Buffer.from(base64Data, 'base64');
        } else {
          imageData = Buffer.from(element.imageData, 'base64');
        }
      } else if (Buffer.isBuffer(element.imageData)) {
        imageData = element.imageData;
      } else {
        console.warn(`[FFmpegRenderer] Scene ${i} has no valid image data, creating placeholder`);
        imageData = await this._createPlaceholderImage(1080, 1920);
      }
      
      await fs.writeFile(imagePath, imageData);
      imageFiles.push(imagePath);
    }
    
    return imageFiles;
  }

  async _saveAudio(audio, tempDir) {
    const audioFile = path.join(tempDir, 'voiceover.wav');
    
    let audioData;
    if (typeof audio.data === 'string') {
      if (audio.data.startsWith('data:audio')) {
        const base64Data = audio.data.split(',')[1];
        audioData = Buffer.from(base64Data, 'base64');
      } else {
        audioData = Buffer.from(audio.data, 'base64');
      }
    } else if (Buffer.isBuffer(audio.data)) {
      audioData = audio.data;
    } else {
      console.warn('[FFmpegRenderer] No valid audio data, creating silent placeholder');
      audioData = await this._createSilentAudio(audio.duration || 30);
    }
    
    await fs.writeFile(audioFile, audioData);
    return audioFile;
  }

  _buildFFmpegCommand(input, imageFiles, audioFile, outputPath, sceneDuration) {
    const args = [];
    
    // Input images with loop and duration
    for (const imageFile of imageFiles) {
      args.push(
        '-loop', '1',
        '-t', sceneDuration.toString(),
        '-i', imageFile
      );
    }
    
    // Input audio (voiceover)
    args.push('-i', audioFile);
    
    // Build filter complex
    const numScenes = imageFiles.length;
    const audioInputIndex = numScenes;
    
    // Simple approach: concatenate all images, then overlay audio
    // [0:v][1:v][2:v]...concat=n=3:v=1[outv]
    // [3:a]anull[outa]
    // [outv][outa]map
    
    const videoInputs = Array.from({ length: numScenes }, (_, i) => `[${i}:v]`).join('');
    const filterComplex = `${videoInputs}concat=n=${numScenes}:v=1:a=0[outv];[${audioInputIndex}:a]anull[outa]`;
    
    args.push('-filter_complex', filterComplex);
    
    // Map outputs
    args.push('-map', '[outv]', '-map', '[outa]');
    
    // Output settings
    args.push(
      '-c:v', this.config.videoCodec,
      '-b:v', this.config.videoBitrate,
      '-c:a', this.config.audioCodec,
      '-b:a', this.config.audioBitrate,
      '-r', this.config.framerate.toString(),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',
      '-y', outputPath
    );
    
    return args;
  }

  _calculateSceneDuration(input, numScenes) {
    const totalDuration = input.duration || 30;
    return (totalDuration / numScenes).toFixed(2);
  }

  async _executeFFmpeg(args) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.config.ffmpegPath, args);
      
      let stdout = '';
      let stderr = '';
      
      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        if (data.toString().includes('frame=')) {
          console.log(`[FFmpegRenderer] Progress: ${data.toString().trim()}`);
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });
      
      ffmpeg.on('error', (error) => {
        reject(error);
      });
    });
  }

  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async _cleanup(tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('[FFmpegRenderer] Cleanup completed');
    } catch (error) {
      console.warn('[FFmpegRenderer] Cleanup failed:', error);
    }
  }

  async _createPlaceholderImage(width, height) {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
      0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    return pngHeader;
  }

  async _createSilentAudio(durationSeconds) {
    const sampleRate = 44100;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = sampleRate * durationSeconds;
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);
    
    const header = Buffer.alloc(44);
    
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    const silentData = Buffer.alloc(dataSize);
    
    return Buffer.concat([header, silentData]);
  }
}

module.exports = { FFmpegVideoRenderer };
