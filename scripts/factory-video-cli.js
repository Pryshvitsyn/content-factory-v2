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

const { VideoProductionPipeline } = require('../src/v2.1/video-production-pipeline');
const { ProviderGateway } = require('../src/providers/provider-gateway');

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
 * Main entry point
 */
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
    // Initialize pipeline
    const providerGateway = new ProviderGateway();
    const pipeline = new VideoProductionPipeline({
      providerGateway,
      config: {
        verbose: true
      }
    });
    
    // Execute pipeline
    console.log('[FactoryVideoCLI] Executing video production pipeline...\n');
    const result = await pipeline.execute(input);
    
    console.log('\n[FactoryVideoCLI] Video production completed!');
    console.log(`  Job ID:      ${result.jobId}`);
    console.log(`  Output Path: ${result.outputPath}`);
    console.log(`  QA Passed:   ${result.qa.passed}`);
    
    if (result.qa.issues.length > 0) {
      console.log('  QA Issues:');
      result.qa.issues.forEach(issue => console.log(`    - ${issue}`));
    }
    
    console.log('\n[FactoryVideoCLI] Artifacts generated:');
    console.log(`  - Script:   ${result.artifacts.script ? '✓' : '✗'}`);
    console.log(`  - Audio:    ${result.artifacts.audio ? '✓' : '✗'}`);
    console.log(`  - Visuals:  ${result.artifacts.visuals ? '✓' : '✗'}`);
    console.log(`  - Rendered: ${result.artifacts.rendered ? '✓' : '✗'}`);
    
  } catch (error) {
    console.error('\n[FactoryVideoCLI] Error during video production:');
    console.error(error);
    process.exit(1);
  }
}

// Run
main();
