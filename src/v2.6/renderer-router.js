'use strict';

class RendererRoutingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RendererRoutingError';
    this.code = code;
  }
}

class QualityRendererLane {
  constructor({ masterOrchestrator, mediaExecutionRepository, qualityEvaluator = null } = {}) {
    if (!masterOrchestrator || typeof masterOrchestrator.build !== 'function') throw new Error('masterOrchestrator is required');
    this.masterOrchestrator = masterOrchestrator;
    this.mediaExecutionRepository = mediaExecutionRepository;
    this.qualityEvaluator = qualityEvaluator;
  }

  async preflight({ input, brand, existing }) {
    let probe = null;
    let executions = [];
    if (input.schemaVersion >= 2) {
      if (!this.mediaExecutionRepository) {
        throw new RendererRoutingError('V25_MEDIA_EXECUTION_REQUIRED', 'V2.5 durable media execution repository is required');
      }
      await this.mediaExecutionRepository.inspectSchema();
      probe = await this.mediaExecutionRepository.verifyTransactionalPlan({
        workspaceId: brand.workspaceId,
        brandId: brand.id,
        objective: input.objective,
        inputFingerprint: input.fingerprint,
        assets: input.assetPlan.assets,
      });
      if (existing?.productionId) executions = await this.mediaExecutionRepository.list(existing.productionId);
    }
    return { probe, executions, availability: { configured: true, status: 'READY' } };
  }

  plan({ input, config, existing, laneState }) {
    const completed = new Set(laneState.executions.filter((item) => item.status === 'SUCCEEDED').map((item) => item.asset_id));
    const ambiguous = new Set(laneState.executions.filter((item) => ['MAY_HAVE_STARTED','NEEDS_RECONCILIATION'].includes(item.status)).map((item) => item.asset_id));
    const pending = existing?.jobStatus === 'COMPLETED' ? [] : input.assetPlan.assets.filter((asset) => (
      !completed.has(asset.asset_id) && !ambiguous.has(asset.asset_id)
    ));
    const videos = input.assetPlan.assets.filter((asset) => asset.kind === 'video');
    const audio = input.assetPlan.assets.filter((asset) => asset.kind === 'voice' || asset.kind === 'audio');
    const videoProfile = videos[0]?.generation_requirements || input.profile || {};
    const audioProfile = audio[0]?.generation_requirements || {};
    const semanticAdapter = this.qualityEvaluator?.semanticAdapter || null;
    const qualityEvaluatorPolicy = !semanticAdapter || semanticAdapter.provider === 'unconfigured'
      ? 'SEMANTIC_VISUAL_QA_NOT_CONFIGURED' : 'CONFIGURED_BOUNDED';
    const selectedTier = String(videoProfile.profile || input.profile?.profile || 'STANDARD').toUpperCase();
    const expectedQualityEvaluatorCalls = semanticAdapter
      ? (semanticAdapter.estimatedCallsPerEvaluation * (videos.length + 1))
        + (videos.length > 1 ? semanticAdapter.estimatedContinuityCalls || 0 : 0)
      : 0;
    return {
      renderMode: 'QUALITY',
      renderer: 'v2.5-quality',
      provider: videoProfile.provider || config.provider,
      model: videoProfile.model || config.model,
      resolution: videoProfile.resolution,
      aspectRatio: videoProfile.aspect_ratio || videoProfile.aspectRatio,
      numFrames: videoProfile.num_frames || videoProfile.numFrames,
      fps: videoProfile.frames_per_second || videoProfile.framesPerSecond,
      expectedVideoGenerations: pending.filter((asset) => asset.kind === 'video').length,
      expectedAudioGenerations: pending.filter((asset) => asset.kind === 'voice' || asset.kind === 'audio').length,
      audioProvider: audioProfile.provider || null,
      audioModel: audioProfile.model || null,
      expectedPaidProviderCalls: pending.length,
      expectedRendererJobs: 0,
      ambiguousProviderExecutions: ambiguous.size,
      masterAssemblyMode: videos.length > 1 || audio.length ? 'ffmpeg-multi-track' : 'ffmpeg-single-visual',
      rendererAvailability: laneState.availability,
      dryRunRendererExecutions: 0,
      expectedQualityEvaluatorCalls,
      qualityEvaluatorPolicy,
      expectedExternalExecutionClasses: [
        ...(pending.some((asset) => asset.kind === 'video') ? ['VIDEO_GENERATION'] : []),
        ...(pending.some((asset) => asset.kind === 'voice' || asset.kind === 'audio') ? ['SPEECH_GENERATION'] : []),
        ...(expectedQualityEvaluatorCalls ? ['VISUAL_EVALUATION'] : []),
      ],
      readiness: qualityEvaluatorPolicy === 'SEMANTIC_VISUAL_QA_NOT_CONFIGURED' && selectedTier !== 'ECONOMY'
        ? 'BLOCKED' : 'READY',
    };
  }

  async render(context) { return this.masterOrchestrator.build(context); }
}

class RendererRouter {
  constructor({ qualityLane, fastRenderers = {} } = {}) {
    if (!qualityLane) throw new Error('qualityLane is required');
    this.qualityLane = qualityLane;
    this.fastRenderers = new Map(Object.entries(fastRenderers));
  }

  lane(input) {
    const mode = input.renderMode || 'QUALITY';
    if (mode === 'QUALITY') return this.qualityLane;
    if (mode !== 'FAST') throw new RendererRoutingError('RENDER_MODE_UNSUPPORTED', `Unsupported render mode: ${mode}`);
    const renderer = input.fastRender?.renderer || input.renderer;
    const lane = this.fastRenderers.get(renderer);
    if (!lane) throw new RendererRoutingError('FAST_RENDERER_UNAVAILABLE', `FAST renderer is not registered: ${renderer || 'missing'}`);
    return lane;
  }

  preflight(context) { return this.lane(context.input).preflight(context); }
  plan(context) { return this.lane(context.input).plan(context); }
  render(context) { return this.lane(context.input).render(context); }
}

module.exports = { QualityRendererLane, RendererRouter, RendererRoutingError };
