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

  /**
   * Generate content based on type
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} - Generated content
   */
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

  /**
   * Generate text (script)
   * @private
   */
  _generateText(input) {
    const { prompt, maxTokens = 500 } = input;
    
    // Generate a simple mock script
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

  /**
   * Generate audio (TTS)
   * @private
   */
  _generateAudio(input) {
    const { text, lang = 'en', voice = 'default' } = input;
    
    // Create a simple silent audio placeholder (WAV format)
    const sampleRate = 44100;
    const duration = 30; // 30 seconds
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = sampleRate * duration;
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);
    
    const header = Buffer.alloc(44);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    
    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    // Silent data
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

  /**
   * Generate image
   * @private
   */
  _generateImage(input) {
    const { prompt, style = 'tech', aspectRatio = '9:16' } = input;
    
    // Create a minimal PNG placeholder
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
    
    return {
      imageData: pngHeader,
      format: 'png',
      prompt,
      style,
      aspectRatio,
      provider: 'mock'
    };
  }
}

module.exports = { MockProvider };
