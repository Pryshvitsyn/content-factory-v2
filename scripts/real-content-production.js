'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ReplicateWanVideoAdapter } = require('../src/providers/replicate-wan-video-adapter');
const { createOpenAIMediaProvider } = require('../src/providers/openai-media-provider');
const { PostgresAssetRepository } = require('../src/v2.1/asset-repository');
const { FfmpegMasterRenderer } = require('../src/v2.1/ffmpeg-master-renderer');
const { ControlReviewService } = require('../src/v2.3/control-review-service');
const { LiveProductionService } = require('../src/v2.4/live-production-service');
const { assertPaidCredentials, resolveV25Configuration } = require('../src/v2.5/configuration');
const { DurableMediaExecutor, PostgresMediaExecutionRepository } = require('../src/v2.5/durable-media-executor');
const { FfprobeMediaInspector, validateMasterProbe } = require('../src/v2.5/media-validator');
const { buildProductionInput } = require('../src/v2.5/production-input');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');

function planOnlyAdapter(provider, capability, model) {
  return Object.freeze({
    provider,
    supports: ({ capability: requested, model: requestedModel }) => requested === capability && (!requestedModel || requestedModel === model),
    modelFor: () => model,
    async generate() { throw new Error('Plan-only adapter cannot invoke a provider'); },
  });
}

function providerGateway({ config, live, env = process.env }) {
  const providers = live ? {
    replicate: new ReplicateWanVideoAdapter({ apiToken: env.REPLICATE_API_TOKEN, model: config.model }),
    'openai-media': createOpenAIMediaProvider({ apiKey: env.OPENAI_API_KEY, speechModel: config.audioModel }),
  } : {
    replicate: planOnlyAdapter('replicate', 'video-generation', config.model),
    'openai-media': planOnlyAdapter('openai-media', 'speech-generation', config.audioModel),
  };
  return new ProviderGateway({
    providers,
    priorities: { 'video-generation': ['replicate'], 'media:video': ['replicate'],
      'speech-generation': ['openai-media'], 'media:voice': ['openai-media'] },
    routing: { strategy: 'priority', fallbackOnError: false },
  });
}

async function main() {
  const config = resolveV25Configuration(process.env);
  const raw = JSON.parse(await fs.readFile(path.resolve(config.inputFile), 'utf8'));
  const input = buildProductionInput(raw);
  assertPaidCredentials({ config, input });
  const db = new Pool({ connectionString: config.databaseUrl, max: 4 });
  try {
    const storage = new FilesystemStorageAdapter({ root: config.storageRoot });
    const artifactService = new ArtifactService({ storage });
    const gateway = providerGateway({ config, live: config.live });
    const mediaRepository = new PostgresMediaExecutionRepository({ db });
    const mediaExecutor = new DurableMediaExecutor({
      repository: mediaRepository, providerGateway: gateway, artifactService,
      mediaInspector: new FfprobeMediaInspector(), assetRepository: new PostgresAssetRepository(),
    });
    const masterOrchestrator = new MasterProductionOrchestrator({
      providerGateway: gateway, artifactService, renderer: new FfmpegMasterRenderer(),
      reviewService: new ControlReviewService({ db }), mediaExecutor, masterProbeValidator: validateMasterProbe,
    });
    const service = new LiveProductionService({
      db, masterOrchestrator, artifactService, storageRoot: config.storageRoot,
      mediaExecutionRepository: mediaRepository,
    });
    const result = await service.run({ input, config });
    if (result.dryRun) {
      console.log('V2.5 DRY RUN PASSED — provider calls = 0.');
      console.log(JSON.stringify(result.plan, null, 2));
      return;
    }
    console.log('V2.5 REAL CONTENT PRODUCTION COMPLETED');
    console.log(JSON.stringify(result, null, 2));
    console.log('Publication was not triggered. Open the Review Queue with npm run dashboard:local.');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${error.code || 'V25_PRODUCTION_ERROR'}] ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { main, planOnlyAdapter, providerGateway };
