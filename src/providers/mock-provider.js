/**
 * Mock Provider for Testing
 * 
 * Returns placeholder data for testing the video pipeline
 * without requiring actual API keys.
 */

class MockProvider {
  constructor(config = {}) {
    this.name = 'mock';
    this.config = config;
  }

  async generate(options) {
    const { type, input } = options;
    
    console.log(`[MockProvider] Generating ${type}...`, input);
    
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

  _generateText(input) {
    const { prompt, maxTokens = 500 } = input;
    
    const script = `[Mock Script for: ${input.prompt?.substring(0, 50) || 'Unknown'}]

This is a mock script generated for testing purposes.

Scene 1: Introduction
- Show app logo
- Voiceover: "Introducing Now - smart scheduling for busy professionals"

Scene 2: Features
- Show calendar interface
- Voiceover: "Automatically organize your day with AI-powered scheduling"

Scene 3: Call to Action
- Show download button
- Voiceover: "Download Now today and take control of your time!"

[End of Mock Script]`;
    
    return {
      text: script,
      tokens: script.length,
      provider: 'mock'
    };
  }

  _generateAudio(input) {
    const { text, lang = 'en', voice = 'default' } = input;
    
    const sampleRate = 44100;
    const duration = 30;
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
      provider: 'mock',
      lang,
      voice
    };
  }

  _generateImage(input) {
    const { prompt, style = 'tech', aspectRatio = '9:16' } = input;
    
    // Create a simple colored PNG (1080x1920 for 9:16)
    const width = 1080;
    const height = 1920;
    
    // Create PNG header for 1080x1920 RGB image
    const pngHeader = this._createPNGHeader(width, height);
    
    // Create simple image data (solid color based on style)
    const color = this._getColorForStyle(style);
    const rawData = Buffer.alloc(width * height * 3);
    
    for (let i = 0; i < rawData.length; i += 3) {
      rawData[i] = color.r;
      rawData[i + 1] = color.g;
      rawData[i + 2] = color.b;
    }
    
    // For simplicity, just return the header (FFmpeg will handle it)
    // In a real implementation, you'd create proper PNG data
    return {
      imageData: pngHeader,
      format: 'png',
      prompt,
      style,
      aspectRatio,
      provider: 'mock',
      width,
      height
    };
  }

  _createPNGHeader(width, height) {
    // Create a minimal valid PNG (1x1, FFmpeg will scale it)
    // But we'll tell FFmpeg the actual size via command line
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

  _getColorForStyle(style) {
    const colors = {
      tech: { r: 0, g: 122, b: 255 },      // Blue
      luxury: { r: 29, g: 29, b: 31 },     // Black
      minimal: { r: 245, g: 245, b: 247 }  // Light gray
    };
    
    return colors[style] || colors.tech;
  }
}

module.exports = { MockProvider };
