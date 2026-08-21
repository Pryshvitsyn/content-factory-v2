/**
 * CLI script for generating promotional videos
 * 
 * Usage:
 *   node scripts/factory-video-cli.js --app=now --lang=en --duration=30 --style=tech --topic="Smart scheduling"
 * 
 * Options:
 *   --app       Application identifier (now, attune, luxuryitaly)
 *   --lang      Language code (en, it, ru)
 *   --duration  Target duration in seconds (default: 30)
 *   --style     Visual style (tech, luxury, minimal)
 *   --topic     Topic/theme for the video (required)
 */

const path = require('path');
const { VideoFactory, VideoFactoryConfig } = require('../src/v2.1/video-factory');
const { MockProvider } = require('../src/providers/mock-provider');
const { ProviderRegistry } = require('../src/providers/provider-registry');

/**
 * Parse command line arguments
 */
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

/**
 * Validate input parameters
 */
function validateInput(input) {
  const errors = [];
  
  if (!input.app) {
    errors.push('Missing required option: --app');
  }
  
  if (!input.topic) {
    errors.push('Missing required option: --topic');
  }
  
  if (!input.lang) {
    errors.push('Missing required option: --lang');
  }
  
  if (input.duration && (isNaN(input.duration) || input.duration <= 0)) {
    errors.push('Invalid --duration: must be a positive number');
  }
  
  return errors;
}

/**
 * Load configuration
 */
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

/**
 * Register providers
 */
function registerProviders() {
  const registry = ProviderRegistry.getInstance();
  
  // Register mock provider for testing
  registry.register('mock', new MockProvider());
  
  console.log('[FactoryVideoCLI] Providers registered: mock');
}

/**
 * Main entry point
 */
async function main() {
  console.log('[FactoryVideoCLI] Starting video production...\n');
  
  // Register providers
  registerProviders();
  
  const args = parseArgs();
  
  const input = {
    app: args.app,
    lang: args.lang,
    duration: parseInt(args.duration, 10) || 30,
    style: args.style || 'tech',
    topic: args.topic
  };
  
  // Validate input
  const errors = validateInput(input);
  if (errors.length > 0) {
    console.error('[FactoryVideoCLI] Validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nUsage:');
    console.error('  node scripts/factory-video-cli.js --app=now --lang=en --duration=30 --style=tech --topic="Your topic"');
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
    // Load configuration
    const config = loadConfig();
    
    // Initialize factory with config
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
    
    const factory = new VideoFactory(factoryConfig);
    
    // Execute factory
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
      
      console.log('\n[FactoryVideoCLI] Decision Log:');
      result.decisionLog.forEach(decision => {
        console.log(`  - ${decision.type}: ${JSON.stringify(decision.data)}`);
      });
      
      console.log('\n[FactoryVideoCLI] Artifacts generated:');
      console.log(`  - Script:   ${result.artifacts.script ? '✓' : '✗'}`);
      console.log(`  - Audio:    ${result.artifacts.audio ? '✓' : '✗'}`);
      console.log(`  - Visuals:  ${result.artifacts.visuals ? '✓' : '✗'}`);
      console.log(`  - Rendered: ${result.artifacts.rendered ? '✓' : '✗'}`);
      
      console.log(`\n[FactoryVideoCLI] Video saved to: ${result.outputPath}`);
    } else {
      console.error('\n[FactoryVideoCLI] Error:');
      console.error(`  ${result.error}`);
      
      if (result.decisionLog.length > 0) {
        console.error('\n[FactoryVideoCLI] Decision log (for debugging):');
        result.decisionLog.forEach(decision => {
          console.error(`  - ${decision.type}: ${JSON.stringify(decision.data)}`);
        });
      }
      
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n[FactoryVideoCLI] Error during video production:');
    console.error(error);
    process.exit(1);
  }
}

// Run
main();
