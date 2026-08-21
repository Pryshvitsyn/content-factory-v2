/**
 * CLI script for generating promotional videos with NVIDIA
 */

const path = require('path');
const { VideoFactory, VideoFactoryConfig } = require('../src/v2.1/video-factory');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ProviderRegistry } = require('../src/providers/provider-registry');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  args.forEach(arg => {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      const [, key, value] = match;
      parsed[key] = value;
    }
  });
  
  return parsed;
}

function validateInput(input) {
  const errors = [];
  
  if (!input.app) errors.push('Missing required option: --app');
  if (!input.topic) errors.push('Missing required option: --topic');
  if (!input.lang) errors.push('Missing required option: --lang');
  if (input.duration && (isNaN(input.duration) || input.duration <= 0)) {
    errors.push('Invalid --duration: must be a positive number');
  }
  
  return errors;
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'video-factory.json');
  
  try {
    const fs = require('fs');
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    console.warn('[FactoryVideoCLI] Config not found, using defaults');
    return {};
  }
}

function createProviderGateway(config) {
  const registry = new ProviderRegistry();
  
  // Register NVIDIA provider
  if (config.providers && config.providers.includes('nvidia')) {
    try {
      const nvidiaModule = require('../src/providers/nvidia-adapter');
      // Try different export patterns
      const NvidiaProvider = nvidiaModule.NvidiaProvider || nvidiaModule.default || nvidiaModule;
      const nvidia = new NvidiaProvider();
      registry.register('nvidia', nvidia);
      console.log('[FactoryVideoCLI] NVIDIA provider registered ✓');
    } catch (error) {
      console.error('[FactoryVideoCLI] Failed to register NVIDIA provider:', error.message);
      console.log('[FactoryVideoCLI] Falling back to mock provider');
      
      // Fallback to mock
      const { MockProvider } = require('../src/providers/mock-provider');
      registry.register('mock', new MockProvider());
      console.log('[FactoryVideoCLI] Mock provider registered');
    }
  }
  
  return new ProviderGateway(registry);
}

async function main() {
  console.log('[FactoryVideoCLI] Starting video production...\n');
  
  const args = parseArgs();
  
  const input = {
    app: args.app,
    lang: args.lang,
    duration: parseInt(args.duration, 10) || 30,
    style: args.style || 'tech',
    topic: args.topic
  };
  
  const errors = validateInput(input);
  if (errors.length > 0) {
    console.error('[FactoryVideoCLI] Validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  
  console.log('[FactoryVideoCLI] Input parameters:');
  console.log(`  App:      ${input.app}`);
  console.log(`  Language: ${input.lang}`);
  console.log(`  Duration: ${input.duration}s`);
  console.log(`  Style:    ${input.style}`);
  console.log(`  Topic:    ${input.topic}`);
  console.log('');
  
  try {
    const config = loadConfig();
    const providerGateway = createProviderGateway(config);
    
    const factoryConfig = new VideoFactoryConfig({
      ...config,
      rendering: {
        ...config.rendering,
        ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg'
      },
      storage: config.storage || {
        type: 'local',
        basePath: './output/videos'
      }
    });
    
    const factory = new VideoFactory(factoryConfig, providerGateway);
    
    console.log('[FactoryVideoCLI] Executing video factory...\n');
    const result = await factory.generateVideo(input);
    
    console.log('\n[FactoryVideoCLI] Video production completed!');
    console.log(`  Job ID:      ${result.jobId}`);
    console.log(`  Status:      ${result.status}`);
    console.log(`  Output Path: ${result.outputPath}`);
    console.log(`  Duration:    ${result.duration}ms`);
    
    if (result.status === 'success') {
      console.log('\n[FactoryVideoCLI] Quality Assurance:');
      console.log(`  Pre-Compose:  ${result.qa.preCompose ? '✓' : '✗'}`);
      console.log(`  Post-Render:  ${result.qa.postRender ? '✓' : '✗'}`);
      console.log(`  Final QA:     ${result.qa.finalQA ? '✓' : '✗'}`);
      
      console.log('\n[FactoryVideoCLI] Video saved to: ' + result.outputPath);
      console.log('\n[FactoryVideoCLI] Open with: open ' + result.outputPath);
    } else {
      console.error('\n[FactoryVideoCLI] Error:');
      console.error(`  ${result.error}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n[FactoryVideoCLI] Error during video production:');
    console.error(error);
    process.exit(1);
  }
}

main();
