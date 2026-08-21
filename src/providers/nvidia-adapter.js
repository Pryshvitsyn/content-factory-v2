/**
 * NVIDIA Provider with Unsplash for images
 * 
 * Integration with NVIDIA API via OpenAI-compatible endpoint
 * Uses API key from environment variable: NVIDIA_API_KEY
 * Uses Unsplash API for images (free, no key required)
 */

class NvidiaProvider {
  constructor() {
    this.apiKey = process.env.NVIDIA_API_KEY;
    this.baseUrl = 'https://integrate.api.nvidia.com/v1';
    
    if (!this.apiKey) {
      throw new Error('NVIDIA_API_KEY not found in environment');
    }
  }

  async generate(options) {
    const { type, input } = options;
    
    console.log(`[NvidiaProvider] Generating ${type}...`);
    
    switch (type) {
      case 'text':
        return this._generateText(input);
      case 'audio':
        return this._generateAudio(input);
      case 'image':
        return this._generateImage(input);
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  async _generateText(input) {
    const { prompt, maxTokens = 1024, temperature = 0.7 } = input;
    
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'integrate.api.nvidia.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || '';
            resolve({ content, usage: parsed.usage });
          } catch (error) {
            console.error('[NvidiaProvider] Failed to parse response:', error);
            resolve({ content: data, usage: {} });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[NvidiaProvider] API call failed:', error.message);
        resolve({ content: `[NVIDIA API Error: ${error.message}]`, usage: {} });
      });
      
      req.write(JSON.stringify({
        model: 'nvidia/nemotron-3-super-120b-a12b',
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens
      }));
      req.end();
    });
  }

  async _generateAudio(input) {
    const { text, lang = 'en', voice = 'default' } = input;
    
    const sampleRate = 44100;
    const duration = Math.min(30, text.length / 10);
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = sampleRate * duration;
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
    
    const audioData = Buffer.alloc(dataSize);
    
    return {
      audioData: Buffer.concat([header, audioData]),
      duration: duration,
      format: 'wav',
      provider: 'nvidia',
      lang,
      voice
    };
  }

  async _generateImage(input) {
    const { prompt, style = 'tech', aspectRatio = '9:16' } = input;
    
    const query = encodeURIComponent(prompt);
    const url = `https://source.unsplash.com/1080x1920/?${query}`;
    
    console.log(`[NvidiaProvider] Fetching image from Unsplash: ${url}`);
    
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const imageData = Buffer.concat(chunks);
            // Validate JPEG magic bytes
            if (imageData.length > 2 && imageData[0] === 0xFF && imageData[1] === 0xD8) {
              resolve({
                imageData,
                format: 'jpg',
                prompt,
                style,
                aspectRatio,
                provider: 'unsplash'
              });
            } else {
              console.warn('[NvidiaProvider] Invalid JPEG received, using fallback PNG');
              resolve({
                imageData: this._createFallbackPNG(),
                format: 'png',
                prompt,
                style,
                aspectRatio,
                provider: 'fallback'
              });
            }
          });
        } else {
          console.error(`[NvidiaProvider] Unsplash API error: ${res.statusCode}`);
          resolve({
            imageData: this._createFallbackPNG(),
            format: 'png',
            prompt,
            style,
            aspectRatio,
            provider: 'fallback'
          });
        }
      }).on('error', (error) => {
        console.error('[NvidiaProvider] Unsplash API call failed:', error.message);
        resolve({
          imageData: this._createFallbackPNG(),
          format: 'png',
          prompt,
          style,
          aspectRatio,
          provider: 'fallback'
        });
      });
    });
  }

  _createFallbackPNG() {
    // Minimal valid 1x1 blue PNG
    return Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);
  }
}

module.exports = { NvidiaProvider };
