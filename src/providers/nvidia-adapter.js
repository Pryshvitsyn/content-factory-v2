/**
 * Content Provider
 * 
 * Uses Pexels for images and simple TTS for audio
 */

class ContentProvider {
  constructor() {
    this.pexelsApiKey = process.env.PEXELS_API_KEY || 'demo';
  }

  async generate(options) {
    const { type, input } = options;
    
    console.log(`[ContentProvider] Generating ${type}...`);
    
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
    const apiKey = process.env.NVIDIA_API_KEY;
    
    return new Promise((resolve) => {
      if (!apiKey) {
        resolve({ content: `[Script about ${input.prompt?.substring(0, 50)}...]`, usage: {} });
        return;
      }
      
      const options = {
        hostname: 'integrate.api.nvidia.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ content: parsed.choices?.[0]?.message?.content || '', usage: parsed.usage });
          } catch {
            resolve({ content: data, usage: {} });
          }
        });
      });
      
      req.on('error', () => resolve({ content: `[Error]`, usage: {} }));
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
    const { text, lang = 'en' } = input;
    
    // Use Google Translate TTS (free, no API key needed)
    const https = require('https');
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=${lang}&client=tw-ob`;
    
    console.log('[ContentProvider] Fetching TTS from Google...');
    
    return new Promise((resolve) => {
      https.get(ttsUrl, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const audioData = Buffer.concat(chunks);
          const duration = Math.max(3, text.length / 15); // ~15 chars/sec
          resolve({
            audioData,
            duration,
            format: 'mp3',
            provider: 'google-tts'
          });
        });
      }).on('error', () => {
        // Fallback: create silent audio
        const sampleRate = 44100;
        const numSamples = sampleRate * 3;
        resolve({
          audioData: Buffer.alloc(numSamples * 2),
          duration: 3,
          format: 'wav',
          provider: 'fallback'
        });
      });
    });
  }

  async _generateImage(input) {
    const { prompt } = input;
    
    // Use Pexels API
    const https = require('https');
    const query = encodeURIComponent(prompt);
    const url = `https://api.pexels.com/v1/search?query=${query}&per_page=1`;
    
    console.log('[ContentProvider] Fetching image from Pexels...');
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.pexels.com',
        path: `/v1/search?query=${query}&per_page=1`,
        method: 'GET',
        headers: {
          'Authorization': this.pexelsApiKey
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const parsed = JSON.parse(data);
            const photo = parsed.photos?.[0];
            if (photo?.image) {
              // Download the actual image
              const imgUrl = photo.image;
              const imgData = await this._downloadImage(imgUrl);
              resolve({
                imageData: imgData,
                format: 'jpg',
                provider: 'pexels'
              });
            } else {
              resolve({ imageData: this._fallbackImage(), format: 'jpg', provider: 'fallback' });
            }
          } catch {
            resolve({ imageData: this._fallbackImage(), format: 'jpg', provider: 'fallback' });
          }
        });
      });
      
      req.on('error', () => resolve({ imageData: this._fallbackImage(), format: 'jpg', provider: 'fallback' }));
      req.end();
    });
  }

  async _downloadImage(url) {
    const https = require('https');
    return new Promise((resolve) => {
      https.get(url, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', () => resolve(this._fallbackImage()));
    });
  }

  _fallbackImage() {
    // 1080x1920 blue gradient as placeholder
    const width = 1080, height = 1920;
    const size = width * height * 3;
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i += 3) {
      data[i] = 30;     // R
      data[i + 1] = 100; // G
      data[i + 2] = 200; // B
    }
    return data;
  }
}

module.exports = { ContentProvider };
