'use strict';

const { ArtifactService } = require('../artifacts/artifact-service');
const { ProviderGateway } = require('../providers/provider-gateway');
const { createOpenAIMediaProvider } = require('../providers/openai-media-provider');
const { createElevenLabsTtsProvider } = require('../providers/elevenlabs-tts-provider');
const { createVideoAdapter } = require('../v2.8/provider-adapter-factory');
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
const { VisualQualityEvaluator } = require('../v2.9/visual-quality-evaluator');
const { createSemanticVisualEvaluatorAdapter } = require('../v2.9/semantic-visual-evaluator-factory');
const { DisabledSemanticVisualEvaluatorAdapter } = require('../v2.9/semantic-visual-evaluator');
const { PostgresSemanticEvaluationAttemptRepository } = require('../v2.9/semantic-evaluation-retry');

function planOnlyAdapter(provider, capability, model) {
  return Object.freeze({
    provider,
    supports: ({ capability: requested, model: requestedModel }) => requested === capability
      && (!requestedModel || requestedModel === model),
    modelFor: () => model,
    async generate() { throw new Error('Plan-only adapter cannot invoke a provider'); },
  });
}

function uploadedAudioCacheAdapter(model = 'uploaded-audio') {
  const fail = () => {
    const error = new Error('Uploaded human narration must already exist as immutable cached media; generation is forbidden');
    error.code = 'UPLOADED_AUDIO_CACHE_MISSING';
    throw error;
  };
  return Object.freeze({
    provider: 'operator-upload',
    supports: ({ capability, model: requestedModel }) => capability === 'speech-generation'
      && (!requestedModel || requestedModel === model),
    modelFor: ({ capability } = {}) => capability === 'speech-generation' ? model : null,
    generate: fail,
    recover: fail,
  });
}

function forbiddenAdapter(provider, capability, model, code) {
  return Object.freeze({
    provider,
    supports: ({ capability: requested, model: requestedModel }) => requested === capability
      && (!requestedModel || requestedModel === model),
    modelFor: () => model,
    async generate() {
      const error = new Error(`Provider capability '${capability}' is forbidden in this execution mode`);
      error.code = code;
      throw error;
    },
    async recover() {
      const error = new Error(`Provider capability '${capability}' recovery is forbidden in this execution mode`);
      error.code = code;
      throw error;
    },
  });
}

const EXECUTION_POLICIES = Object.freeze(new Set(['LIVE','PLAN_ONLY','FORBIDDEN']));

function providerGateway({ config, live, executionPolicy = null, env = process.env,
  videoAdapterFactory = createVideoAdapter, openAIMediaProviderFactory = createOpenAIMediaProvider,
  elevenLabsTtsProviderFactory = createElevenLabsTtsProvider }) {
  const videoProvider = config.provider;
  const voiceProvider = config.audioProvider;
  const policy = Object.freeze({
    video: executionPolicy?.video || (live ? 'LIVE' : 'PLAN_ONLY'),
    speech: executionPolicy?.speech || (live ? 'LIVE' : 'PLAN_ONLY'),
  });
  for (const [capability, mode] of Object.entries(policy)) {
    if (!EXECUTION_POLICIES.has(mode)) throw new Error(`Invalid ${capability} execution policy '${mode}'`);
  }
  const videoAdapter = policy.video === 'LIVE'
    ? videoAdapterFactory({ provider: videoProvider, model: config.model,
      adapterFamily: config.adapterFamily || (videoProvider === 'replicate' ? 'replicate-wan' : null) }, { env })
    : policy.video === 'FORBIDDEN'
      ? forbiddenAdapter(videoProvider, 'video-generation', config.model, 'SEMANTIC_RECOVERY_VIDEO_GENERATION_FORBIDDEN')
      : planOnlyAdapter(videoProvider, 'video-generation', config.model);
  let voiceAdapter = null;
  if (voiceProvider && voiceProvider !== 'none') {
    if (voiceProvider === 'operator-upload') {
      voiceAdapter = uploadedAudioCacheAdapter(config.audioModel || 'uploaded-audio');
    } else if (policy.speech === 'LIVE') {
      if (voiceProvider === 'elevenlabs') {
        voiceAdapter = elevenLabsTtsProviderFactory({ apiKey: env.ELEVENLABS_API_KEY, model: config.audioModel });
      } else if (voiceProvider === 'openai-media') {
        voiceAdapter = openAIMediaProviderFactory({ apiKey: env.OPENAI_API_KEY, speechModel: config.audioModel });
      } else throw new Error(`Unsupported live speech provider '${voiceProvider}'`);
    } else if (policy.speech === 'FORBIDDEN') {
      voiceAdapter = forbiddenAdapter(voiceProvider, 'speech-generation', config.audioModel,
        'SEMANTIC_RECOVERY_SPEECH_GENERATION_FORBIDDEN');
    } else voiceAdapter = planOnlyAdapter(voiceProvider, 'speech-generation', config.audioModel);
  }
  const providers = { [videoProvider]: videoAdapter, ...(voiceAdapter ? { [voiceProvider]: voiceAdapter } : {}) };
  return new ProviderGateway({
    providers,
    priorities: { 'video-generation': [videoProvider], 'media:video': [videoProvider],
      'speech-generation': voiceProvider && voiceProvider !== 'none' ? [voiceProvider] : [],
      'media:voice': voiceProvider && voiceProvider !== 'none' ? [voiceProvider] : [] },
    routing: { strategy: 'priority', fallbackOnError: false },
  });
}

function unavailableQualityLane() {
  const error = () => { throw Object.assign(new Error('QUALITY lane is not configured in this FAST runtime'),
    { code: 'QUALITY_RENDERER_UNAVAILABLE' }); };
  return Object.freeze({ preflight: error, plan: error, render: error });
}

function createProductionRuntime({ db, storage, config, env = process.env, logger = console,
  reviewService = null, mediaInspector = null, adapterFactory = null, visualQualityEvaluator = null,
  semanticAdapterFactory = createSemanticVisualEvaluatorAdapter, semanticOnly = false,
  mediaExecutorDecorator = null, masterRenderer = null } = {}) {
  if (!db || !storage || !config) throw new Error('db, storage, and config are required');
  const artifactService = new ArtifactService({ storage });
  const reviews = reviewService || new ControlReviewService({ db });
  const inspector = mediaInspector || new FfprobeMediaInspector();
  let masterOrchestrator = null;
  let mediaRepository = null;
  let qualityLane;
  const fastRenderers = {};

  if (config.renderMode === 'QUALITY') {
    const gateway = providerGateway({ config, live: config.live, env,
      executionPolicy: semanticOnly ? { video: 'FORBIDDEN', speech: config.live ? 'LIVE' : 'PLAN_ONLY' } : null });
    mediaRepository = new PostgresMediaExecutionRepository({ db });
    let mediaExecutor = new DurableMediaExecutor({ repository: mediaRepository, providerGateway: gateway,
      artifactService, mediaInspector: inspector, assetRepository: new PostgresAssetRepository() });
    if (mediaExecutorDecorator) mediaExecutor = mediaExecutorDecorator(mediaExecutor, {
      repository: mediaRepository, artifactService, storage, mediaInspector: inspector,
    });
    const semanticAdapter = config.semanticVisualQaEnforced === false
      ? new DisabledSemanticVisualEvaluatorAdapter({ enforcementEnabled: false,
        configurationStatus: 'LEGACY_NOT_ENFORCED' })
      : semanticAdapterFactory({ env });
    const evaluator = visualQualityEvaluator || new VisualQualityEvaluator({ semanticAdapter });
    masterOrchestrator = new MasterProductionOrchestrator({ providerGateway: gateway, artifactService,
      renderer: masterRenderer || new FfmpegMasterRenderer(), reviewService: reviews, mediaExecutor,
      masterProbeValidator: validateMasterProbe, sourceQualityEvaluator: evaluator, finalQualityEvaluator: evaluator });
    qualityLane = new QualityRendererLane({ masterOrchestrator, mediaExecutionRepository: mediaRepository,
      qualityEvaluator: evaluator });
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
    storageRoot: config.storageRoot, mediaExecutionRepository: mediaRepository, mediaExecutor: masterOrchestrator?.mediaExecutor,
    visualQualityEvaluator: masterOrchestrator?.sourceQualityEvaluator,
    semanticAttemptRepository: new PostgresSemanticEvaluationAttemptRepository({ db }), rendererRouter, logger });
  return Object.freeze({ service, rendererRouter, artifactService, reviewService: reviews,
    mediaExecutionRepository: mediaRepository, mediaExecutor: masterOrchestrator?.mediaExecutor,
    visualQualityEvaluator: masterOrchestrator?.sourceQualityEvaluator || null });
}

module.exports = { EXECUTION_POLICIES, createProductionRuntime, forbiddenAdapter, planOnlyAdapter, providerGateway,
  uploadedAudioCacheAdapter };
