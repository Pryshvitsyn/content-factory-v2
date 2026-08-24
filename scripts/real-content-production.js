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
const { DurableFastRenderer, PostgresFastRenderRepository } = require('../src/v2.6/durable-fast-renderer');
const { MoneyPrinterTurboAdapter } = require('../src/v2.6/moneyprinterturbo-adapter');
const { QualityRendererLane, RendererRouter } = require('../src/v2.6/renderer-router');

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
  if (!process.env.REAL_PRODUCTION_INPUT) throw Object.assign(new Error('REAL_PRODUCTION_INPUT is required'), { code: 'V25_CONFIGURATION_INVALID' });
  const raw = JSON.parse(await fs.readFile(path.resolve(process.env.REAL_PRODUCTION_INPUT), 'utf8'));
  const input = buildProductionInput(raw);
  const config = resolveV25Configuration(process.env, input);
  assertPaidCredentials({ config, input });
  const db = new Pool({ connectionString: config.databaseUrl, max: 4 });
  try {
    const storage = new FilesystemStorageAdapter({ root: config.storageRoot });
    const artifactService = new ArtifactService({ storage });
    const reviewService = new ControlReviewService({ db });
    const mediaInspector = new FfprobeMediaInspector();
    let masterOrchestrator = null;
    let mediaRepository = null;
    let qualityLane;
    const fastRenderers = {};
    if (config.renderMode === 'QUALITY') {
      const gateway = providerGateway({ config, live: config.live });
      mediaRepository = new PostgresMediaExecutionRepository({ db });
      const mediaExecutor = new DurableMediaExecutor({ repository: mediaRepository, providerGateway: gateway, artifactService,
        mediaInspector, assetRepository: new PostgresAssetRepository() });
      masterOrchestrator = new MasterProductionOrchestrator({ providerGateway: gateway, artifactService,
        renderer: new FfmpegMasterRenderer(), reviewService, mediaExecutor, masterProbeValidator: validateMasterProbe });
      qualityLane = new QualityRendererLane({ masterOrchestrator, mediaExecutionRepository: mediaRepository });
    } else {
      qualityLane = Object.freeze({
        async preflight() { throw new Error('QUALITY lane is not configured in a FAST-only process'); },
        plan() { throw new Error('QUALITY lane is not configured in a FAST-only process'); },
        async render() { throw new Error('QUALITY lane is not configured in a FAST-only process'); },
      });
      const adapter = new MoneyPrinterTurboAdapter({ config: config.fastRenderer });
      fastRenderers[config.fastRenderer.renderer] = new DurableFastRenderer({
        repository: new PostgresFastRenderRepository({ db }), adapter, artifactService, mediaInspector, reviewService,
      });
    }
    const rendererRouter = new RendererRouter({ qualityLane, fastRenderers });
    const service = new LiveProductionService({
      db, masterOrchestrator, artifactService, storageRoot: config.storageRoot,
      mediaExecutionRepository: mediaRepository, rendererRouter,
    });
    const result = await service.run({ input, config });
    if (result.dryRun) {
      console.log(input.schemaVersion >= 3
        ? 'V2.6 DRY RUN PASSED — provider/renderer jobs = 0.'
        : 'V2.5 DRY RUN PASSED — provider calls = 0.');
      console.log(JSON.stringify(result.plan, null, 2));
      return;
    }
    console.log(`${input.schemaVersion >= 3 ? 'V2.6' : 'V2.5'} REAL CONTENT PRODUCTION COMPLETED`);
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
