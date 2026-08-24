'use strict';

const { ArtifactService } = require('../artifacts/artifact-service');
const { ProviderGateway } = require('../providers/provider-gateway');
const { ReplicateWanVideoAdapter } = require('../providers/replicate-wan-video-adapter');
const { createOpenAIMediaProvider } = require('../providers/openai-media-provider');
const { PostgresAssetRepository } = require('../v2.1/asset-repository');
const { FfmpegMasterRenderer } = require('../v2.1/ffmpeg-master-renderer');
const { ControlReviewService } = require('../v2.3/control-review-service');
const { LiveProductionService } = require('../v2.4/live-production-service');
const { DurableMediaExecutor, PostgresMediaExecutionRepository } = require('../v2.5/durable-media-executor');
const { FfprobeMediaInspector, validateMasterProbe } = require('../v2.5/media-validator');
const { MasterProductionOrchestrator } = require('../../worker/v2.1-master-production');
const { DurableFastRenderer, PostgresFastRenderRepository } = require('../v2.6/durable-fast-renderer');
const { MoneyPrinterTurboAdapter } = require('../v2.6/moneyprinterturbo-adapter');
const { QualityRendererLane, RendererRouter } = require('../v2.6/renderer-router');

function planOnlyAdapter(provider, capability, model) {
  return Object.freeze({
    provider,
    supports: ({ capability: requested, model: requestedModel }) => requested === capability
      && (!requestedModel || requestedModel === model),
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

function unavailableQualityLane() {
  const error = () => { throw Object.assign(new Error('QUALITY lane is not configured in this FAST runtime'),
    { code: 'QUALITY_RENDERER_UNAVAILABLE' }); };
  return Object.freeze({ preflight: error, plan: error, render: error });
}

function createProductionRuntime({ db, storage, config, env = process.env, logger = console,
  reviewService = null, mediaInspector = null, adapterFactory = null } = {}) {
  if (!db || !storage || !config) throw new Error('db, storage, and config are required');
  const artifactService = new ArtifactService({ storage });
  const reviews = reviewService || new ControlReviewService({ db });
  const inspector = mediaInspector || new FfprobeMediaInspector();
  let masterOrchestrator = null;
  let mediaRepository = null;
  let qualityLane;
  const fastRenderers = {};

  if (config.renderMode === 'QUALITY') {
    const gateway = providerGateway({ config, live: config.live, env });
    mediaRepository = new PostgresMediaExecutionRepository({ db });
    const mediaExecutor = new DurableMediaExecutor({ repository: mediaRepository, providerGateway: gateway,
      artifactService, mediaInspector: inspector, assetRepository: new PostgresAssetRepository() });
    masterOrchestrator = new MasterProductionOrchestrator({ providerGateway: gateway, artifactService,
      renderer: new FfmpegMasterRenderer(), reviewService: reviews, mediaExecutor,
      masterProbeValidator: validateMasterProbe });
    qualityLane = new QualityRendererLane({ masterOrchestrator, mediaExecutionRepository: mediaRepository });
  } else {
    qualityLane = unavailableQualityLane();
    const adapter = adapterFactory ? adapterFactory(config.fastRenderer)
      : new MoneyPrinterTurboAdapter({ config: config.fastRenderer });
    fastRenderers[config.fastRenderer.renderer] = new DurableFastRenderer({
      repository: new PostgresFastRenderRepository({ db }), adapter, artifactService,
      mediaInspector: inspector, reviewService: reviews,
    });
  }

  const rendererRouter = new RendererRouter({ qualityLane, fastRenderers });
  const service = new LiveProductionService({ db, masterOrchestrator, artifactService,
    storageRoot: config.storageRoot, mediaExecutionRepository: mediaRepository, rendererRouter, logger });
  return Object.freeze({ service, rendererRouter, artifactService, reviewService: reviews,
    mediaExecutionRepository: mediaRepository });
}

module.exports = { createProductionRuntime, planOnlyAdapter, providerGateway };
