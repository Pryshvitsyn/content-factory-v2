'use strict';

const crypto = require('node:crypto');
const { validateShape } = require('./v2.1-structured-production');
const { generateMediaAsset } = require('./v2.1-media-generation');
const { buildTimeline, assembleMedia } = require('./v2.1-timeline-assembly');
const { containsSemanticSegment, normalizeSpokenCopy, semanticCopyEqual,
  semanticSegmentsEqual } = require('../src/v2.8.1/spoken-copy-contract');
const { combineResults, qualityCheck, qualityResult: structuredQualityResult, REASON_CODES } = require('../src/v2.9/quality-contract');
const { AudioQualityEvaluator, EditorialQualityEvaluator, buildProductionQuality } = require('../src/v2.9/audio-editorial-quality');

const FINAL_MASTER_DELIVERY_PROFILE = Object.freeze({
  width: 1080,
  height: 1920,
  fps: 30,
});

const DEFAULT_QUALITY_POLICY = Object.freeze({
  ...FINAL_MASTER_DELIVERY_PROFILE,
  durationToleranceMs: 1000,
  requireHook: true,
  requireCta: true,
  requireVoiceForSpokenCopy: true,
  requireAudio: true,
  requireProviderCompatibility: false,
  requireVoiceTimingPlan: false,
});

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function assertBrandScope(brandId, values) {
  requireValue('brandId', brandId);
  for (const [name, value] of Object.entries(values)) {
    const declared = value?.brand_id || value?.brandId;
    if (declared && declared !== brandId) {
      const error = new Error(`${name} belongs to a different brand`);
      error.code = 'BRAND_SCOPE_MISMATCH';
      throw error;
    }
  }
}

function canonicalFingerprint(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    }
    return input;
  };
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => (
    Buffer.isBuffer(item) || key === 'jpeg' || key === 'gray' ? undefined : item
  )));
}

async function persistVisualQualityEvidence({ artifactService, brandId, productionId, assetId,
  sourceArtifact, evaluation, evaluationClass = 'source' } = {}) {
  const sampledFrames = [];
  for (let index = 0; index < (evaluation.sampledFrames || []).length; index += 1) {
    const frame = evaluation.sampledFrames[index];
    const frameArtifact = await artifactService.createVersion({
      artifactId: `brand:${brandId}:asset:${assetId}:quality:${evaluationClass}:frame:${index + 1}`,
      type: 'binary', content: frame.jpeg,
      idempotencyKey: `${sourceArtifact?.contentHash || assetId}:${evaluationClass}:${frame.timestampMs}:${frame.analysisHash}`,
      provider: 'ffmpeg', model: 'v2.9-deterministic-frame-sampler', validationStatus: 'quality_evidence',
    });
    sampledFrames.push(Object.freeze({ ratio: frame.ratio, timestampMs: frame.timestampMs,
      analysisHash: frame.analysisHash, artifactId: frameArtifact.artifactId,
      artifactVersion: frameArtifact.version, storageKey: frameArtifact.storageKey,
      contentHash: frameArtifact.contentHash, contentType: 'image/jpeg' }));
  }
  const sanitized = { ...jsonSafe(evaluation), sampledFrames };
  const evidenceArtifact = await artifactService.createVersion({
    artifactId: `brand:${brandId}:asset:${assetId}:quality:${evaluationClass}:evaluation`, type: 'text',
    content: JSON.stringify({ schemaVersion: '2.9', brandId, productionId, assetId,
      sourceArtifact: sourceArtifact ? { artifactId: sourceArtifact.artifactId, version: sourceArtifact.version,
        storageKey: sourceArtifact.storageKey, contentHash: sourceArtifact.contentHash } : null,
      evaluation: sanitized }),
    idempotencyKey: `${sourceArtifact?.contentHash || assetId}:${evaluationClass}:${canonicalFingerprint(sanitized)}`,
    provider: 'content-factory-quality', model: 'v2.9.1', validationStatus: 'quality_evidence',
  });
  return Object.freeze({ ...sanitized, evidenceArtifact: Object.freeze({ artifactId: evidenceArtifact.artifactId,
    version: evidenceArtifact.version, storageKey: evidenceArtifact.storageKey, contentHash: evidenceArtifact.contentHash }) });
}

function contentTypeForKind(kind) {
  return { image: 'image/png', video: 'video/mp4', voice: 'audio/mpeg', audio: 'audio/mpeg' }[kind] || 'application/octet-stream';
}

function buildMasterTimeline({ productionId, script, shotPlan, assetPlan, fps = 30 } = {}) {
  requireValue('productionId', productionId);
  validateShape('SCRIPT', script);
  validateShape('SHOT_PLAN', shotPlan);
  validateShape('ASSET_PLAN', assetPlan);

  const shotIds = shotPlan.shots.map((shot) => String(shot.shot_id));
  const assetIds = assetPlan.assets.map((asset) => String(asset.asset_id));
  if (new Set(shotIds).size !== shotIds.length) throw new Error('SHOT_PLAN contains duplicate shot_id values');
  if (new Set(assetIds).size !== assetIds.length) throw new Error('ASSET_PLAN contains duplicate asset_id values');
  const unsupported = assetPlan.assets.find((asset) => !['image', 'video', 'voice', 'audio'].includes(asset.kind));
  if (unsupported) throw new Error(`Unsupported master asset kind: ${unsupported.kind}`);

  const scenes = new Set(script.scenes.map((scene) => String(scene.scene_number)));
  const assets = new Map(assetPlan.assets.map((asset) => [String(asset.asset_id), asset]));
  const shotWindows = new Map();
  const clips = [];
  let cursorMs = 0;

  for (const shot of shotPlan.shots) {
    if (!scenes.has(String(shot.scene_id))) throw new Error(`Shot ${shot.shot_id} references an unknown scene`);
    const durationMs = Math.round(Number(shot.duration_seconds) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`Shot ${shot.shot_id} has invalid duration`);
    const required = shot.required_assets.map((assetId) => {
      const asset = assets.get(String(assetId));
      if (!asset) throw new Error(`Shot ${shot.shot_id} references missing asset ${assetId}`);
      return asset;
    });
    const visuals = required.filter((asset) => asset.kind === 'image' || asset.kind === 'video');
    const explicitPrimary = visuals.filter((asset) => asset.generation_requirements?.role === 'primary_visual');
    const primary = explicitPrimary.length === 1 ? explicitPrimary[0] : visuals.length === 1 ? visuals[0] : null;
    if (!primary) throw new Error(`Shot ${shot.shot_id} must have exactly one primary image or video asset`);

    clips.push({
      id: `${shot.shot_id}:visual`,
      assetId: primary.asset_id,
      kind: primary.kind,
      track: 'video-main',
      startMs: cursorMs,
      durationMs,
      sourceOffsetMs: Number(primary.generation_requirements?.source_offset_ms || 0),
      shotId: shot.shot_id,
      sceneId: shot.scene_id,
    });
    shotWindows.set(String(shot.shot_id), { startMs: cursorMs, endMs: cursorMs + durationMs });
    cursorMs += durationMs;
  }

  for (const asset of assetPlan.assets.filter((item) => item.kind === 'voice' || item.kind === 'audio')) {
    const windows = asset.required_for_shots.map((shotId) => {
      const window = shotWindows.get(String(shotId));
      if (!window) throw new Error(`Asset ${asset.asset_id} references unknown shot ${shotId}`);
      return window;
    });
    const startMs = Math.min(...windows.map((window) => window.startMs));
    const endMs = Math.max(...windows.map((window) => window.endMs));
    clips.push({
      id: `${asset.asset_id}:${asset.kind}`,
      assetId: asset.asset_id,
      kind: asset.kind,
      track: asset.kind === 'voice' ? `voice:${asset.asset_id}` : `audio:${asset.asset_id}`,
      startMs,
      durationMs: endMs - startMs,
      sourceOffsetMs: Number(asset.generation_requirements?.source_offset_ms || 0),
    });
  }

  return buildTimeline({ productionId, clips, fps });
}

function qualityResult(checks, validationClass) {
  const status = checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS';
  return Object.freeze({
    status,
    score: Number((checks.filter((check) => check.status === 'PASS').length / checks.length).toFixed(3)),
    validationClass,
    checks: Object.freeze(checks),
    readyForHumanReview: validationClass === 'COMBINED' && status === 'PASS',
    publicationAllowed: false,
    approvalStatus: validationClass === 'COMBINED'
      ? (status === 'PASS' ? 'AWAITING_HUMAN_APPROVAL' : 'BLOCKED')
      : 'NOT_APPLICABLE',
  });
}

function validationCheck(code, ok, message, actual, expected, details = {}) {
  return Object.freeze({ code, status: ok ? 'PASS' : 'FAIL', message,
    details: Object.freeze({ actual, expected, ...details }) });
}

function validatePreExecutionQuality({ productionId = 'preflight', script, shotPlan, assetPlan, policy = {} } = {}) {
  const settings = { ...DEFAULT_QUALITY_POLICY, ...policy };
  const checks = [];
  const add = (code, ok, message, actual, expected, details) => {
    checks.push(validationCheck(code, ok, message, actual, expected, details));
  };
  const sceneCopy = script.scenes.map((scene) => String(scene.dialogue_or_voiceover || ''));
  const legacySceneCopy = sceneCopy.filter(Boolean).join(' ');
  const approvedCopy = String(script.approved_spoken_copy || legacySceneCopy).trim();
  const normalizedApproved = normalizeSpokenCopy(approvedCopy);
  const normalizedScenes = sceneCopy.map(normalizeSpokenCopy);
  const voiceAssets = assetPlan.assets.filter((asset) => asset.kind === 'voice');
  const plannedVoiceCopy = voiceAssets.map((asset) => asset.generation_requirements?.text || '').join(' ').trim();
  const strictApprovedCopy = policy.strictApprovedCopy ?? script.spoken_copy_policy?.strict_approved_copy ?? true;
  const sceneIds = new Set(script.scenes.map((scene) => String(scene.scene_number)));
  const shotIds = new Set(shotPlan.shots.map((shot) => String(shot.shot_id)));
  const assets = new Map(assetPlan.assets.map((asset) => [String(asset.asset_id), asset]));
  const shotSceneReferences = shotPlan.shots.every((shot) => sceneIds.has(String(shot.scene_id)));
  const requiredAssetReferences = shotPlan.shots.every((shot) => shot.required_assets.every((id) => assets.has(String(id))))
    && assetPlan.assets.every((asset) => asset.required_for_shots.every((id) => shotIds.has(String(id))));
  const masterStructure = shotPlan.shots.every((shot) => {
    const visualCount = shot.required_assets.map((id) => assets.get(String(id)))
      .filter((asset) => asset && ['image','video'].includes(asset.kind)).length;
    return visualCount === 1;
  });
  const sceneTiming = script.scenes.every((scene) => {
    const planned = shotPlan.shots.filter((shot) => String(shot.scene_id) === String(scene.scene_number))
      .reduce((sum, shot) => sum + Number(shot.duration_seconds) * 1000, 0);
    return Math.abs(planned - Number(scene.duration_seconds) * 1000) <= 250;
  });
  const plannedDurationMs = shotPlan.shots.reduce((sum, shot) => sum + Math.round(Number(shot.duration_seconds) * 1000), 0);
  const voiceTimingPlan = voiceAssets.every((asset) => {
    const temporal = asset.generation_requirements?.temporal;
    return temporal && Number(temporal.startMs) === 0
      && Math.abs(Number(temporal.durationMs) - plannedDurationMs) <= 250
      && Math.abs(Number(temporal.endMs) - plannedDurationMs) <= 250;
  });
  let timelineError = null;
  try { buildMasterTimeline({ productionId, script, shotPlan, assetPlan, fps: settings.fps }); }
  catch (error) { timelineError = error; }
  const providerPlanValid = assetPlan.assets.filter((asset) => asset.source_preference === 'generate').every((asset) => {
    const requirements = asset.generation_requirements || {};
    const providerModel = typeof requirements.provider === 'string' && requirements.provider.trim()
      && typeof requirements.model === 'string' && requirements.model.trim();
    return Boolean(providerModel && (asset.kind !== 'video' || (
      typeof requirements.profile === 'string' && requirements.profile.trim()
      && typeof requirements.capability === 'string' && requirements.capability.trim()
      && typeof requirements.aspect_ratio === 'string' && requirements.aspect_ratio.trim()
      && typeof requirements.resolution === 'string' && requirements.resolution.trim()
    )));
  });

  add('approved_spoken_copy', Boolean(normalizedApproved), 'Approved spoken copy is present.', normalizedApproved, 'non-empty canonical token sequence');
  add('editorial_hook', !settings.requireHook || containsSemanticSegment(approvedCopy, script.hook),
    'The required hook is present in approved spoken copy.', normalizeSpokenCopy(script.hook), 'ordered segment of approved_spoken_copy');
  add('editorial_cta', !settings.requireCta || containsSemanticSegment(approvedCopy, script.cta),
    'The required CTA is present in approved spoken copy.', normalizeSpokenCopy(script.cta), 'ordered segment of approved_spoken_copy');
  add('scene_copy_distribution', semanticSegmentsEqual(sceneCopy, approvedCopy),
    'Ordered scene spoken-copy segments preserve the approved narrative.', normalizedScenes, normalizedApproved);
  add('spoken_copy_voice', !settings.requireVoiceForSpokenCopy || !normalizedApproved || voiceAssets.length === 1,
    'Exactly one voice asset is planned when approved spoken copy requires speech.', voiceAssets.length, settings.requireVoiceForSpokenCopy ? 1 : 'not required');
  add('voice_copy_integrity', !settings.requireVoiceForSpokenCopy || !normalizedApproved
    || (strictApprovedCopy ? semanticCopyEqual(plannedVoiceCopy, approvedCopy)
      : containsSemanticSegment(plannedVoiceCopy, approvedCopy)),
    'Planned speech text matches authoritative approved spoken copy.', normalizeSpokenCopy(plannedVoiceCopy), normalizedApproved,
    { strictApprovedCopy });
  add('shot_scene_references', shotSceneReferences, 'Every shot references a known scene.', shotSceneReferences, true);
  add('required_assets', requiredAssetReferences, 'Shot and asset references are complete and bidirectionally valid.', requiredAssetReferences, true);
  add('scene_timing', sceneTiming, 'Shot timing matches each scene plan.', sceneTiming, true);
  add('voice_timing_plan', !settings.requireVoiceTimingPlan || !settings.requireVoiceForSpokenCopy || voiceTimingPlan,
    'Planned voice timing spans the deterministic master timeline.',
    voiceAssets.map((asset) => asset.generation_requirements?.temporal || null), { startMs: 0, durationMs: plannedDurationMs, endMs: plannedDurationMs });
  add('expected_master_structure', masterStructure && !timelineError,
    'The planned master has one visual per shot and a buildable timeline.', timelineError?.message || masterStructure, true);
  add('continuity', Boolean(String(shotPlan.continuity?.visual_style || '').trim()),
    'A visual continuity style is defined.', String(shotPlan.continuity?.visual_style || ''), 'non-empty');
  add('provider_compatibility', !settings.requireProviderCompatibility || providerPlanValid,
    'Generated assets have compatible explicit provider, model, profile, capability, and format selections.', providerPlanValid, true);
  add('final_delivery_profile', settings.width > 0 && settings.height > 0 && settings.fps > 0,
    'Final master delivery settings are explicit and independent of provider source settings.',
    { width: settings.width, height: settings.height, fps: settings.fps },
    { width: settings.width, height: settings.height, fps: settings.fps },
    { canonicalDefault: FINAL_MASTER_DELIVERY_PROFILE });
  return qualityResult(checks, 'PRE_EXECUTION');
}

function validatePostRenderQuality({ timeline, probe, policy = {} } = {}) {
  const settings = { ...DEFAULT_QUALITY_POLICY, ...policy };
  const checks = [
    validationCheck('resolution', probe.width === settings.width && probe.height === settings.height,
      'Final master matches the delivery resolution.', `${probe.width}x${probe.height}`, `${settings.width}x${settings.height}`),
    validationCheck('frame_rate', Math.abs(probe.fps - settings.fps) < 0.1,
      'Final master matches the delivery frame rate.', probe.fps, settings.fps),
    validationCheck('duration', Math.abs(probe.durationMs - timeline.durationMs) <= settings.durationToleranceMs,
      'Final master duration matches the planned timeline.', probe.durationMs, timeline.durationMs,
      { toleranceMs: settings.durationToleranceMs }),
    validationCheck('video_codec', Boolean(probe.videoCodec), 'Final master contains a video stream.', probe.videoCodec || null, 'present'),
    validationCheck('audio_track', !settings.requireAudio || probe.hasAudio === true,
      'Final master contains the required audio stream.', probe.hasAudio === true, settings.requireAudio),
  ];
  return qualityResult(checks, 'POST_RENDER');
}

function combineQuality(preExecution, postRender) {
  const combined = qualityResult([...preExecution.checks, ...postRender.checks], 'COMBINED');
  return Object.freeze({ ...combined, preExecution, postRender });
}

function validateMasterQuality({ productionId = 'validation', script, shotPlan, assetPlan, timeline, probe, policy = {} } = {}) {
  return combineQuality(
    validatePreExecutionQuality({ productionId, script, shotPlan, assetPlan, policy }),
    validatePostRenderQuality({ timeline, probe, policy }),
  );
}

class MasterProductionOrchestrator {
  constructor({ providerGateway, artifactService, renderer, reviewService = null, mediaExecutor = null,
    masterProbeValidator = null, sourceQualityEvaluator = null, finalQualityEvaluator = null,
    audioQualityEvaluator = new AudioQualityEvaluator(), editorialQualityEvaluator = new EditorialQualityEvaluator() } = {}) {
    requireValue('providerGateway', providerGateway);
    requireValue('artifactService', artifactService);
    requireValue('renderer', renderer);
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.renderer = renderer;
    this.reviewService = reviewService;
    this.mediaExecutor = mediaExecutor;
    this.masterProbeValidator = masterProbeValidator;
    this.sourceQualityEvaluator = sourceQualityEvaluator;
    this.finalQualityEvaluator = finalQualityEvaluator || sourceQualityEvaluator;
    this.audioQualityEvaluator = audioQualityEvaluator;
    this.editorialQualityEvaluator = editorialQualityEvaluator;
  }

  async build({ productionId, workspaceId = null, brandId, workerId, script, shotPlan, assetPlan, resolvedMedia = [], qualityPolicy = {} } = {}) {
    requireValue('productionId', productionId);
    requireValue('workerId', workerId);
    assertBrandScope(brandId, { script, shotPlan, assetPlan });

    const settings = { ...DEFAULT_QUALITY_POLICY, ...qualityPolicy };
    const preExecutionValidation = validatePreExecutionQuality({ productionId, script, shotPlan, assetPlan, policy: settings });
    if (preExecutionValidation.status !== 'PASS') {
      const error = new Error('Deterministic master plan validation failed before provider execution');
      error.code = 'PRE_EXECUTION_VALIDATION_FAILED';
      error.details = { validation: preExecutionValidation, providerExecutions: 0 };
      throw error;
    }
    const timeline = buildMasterTimeline({ productionId, script, shotPlan, assetPlan, fps: settings.fps });
    const reusable = new Map(resolvedMedia.map((media) => [String(media.assetId), media]));
    const mediaResults = [];
    const sourceEvaluations = [];
    const rawSourceEvaluations = [];
    const qualityTier = String(assetPlan.assets.find((asset) => asset.kind === 'video')?.generation_requirements?.profile || 'STANDARD').toUpperCase();
    const finalSemanticEvaluationRequired = qualityTier === 'PREMIUM' || qualityPolicy.masterVisualTransforms === true;
    for (const asset of assetPlan.assets) {
      if (!['image', 'video', 'voice', 'audio'].includes(asset.kind)) continue;
      let media = reusable.get(String(asset.asset_id));
      if (media) {
        if (media.brandId && media.brandId !== brandId) {
          const error = new Error(`Resolved media ${asset.asset_id} belongs to a different brand`);
          error.code = 'BRAND_SCOPE_MISMATCH';
          throw error;
        }
        if (!media.artifact) throw new Error(`Resolved media ${asset.asset_id} must reference an immutable artifact`);
      } else if (this.mediaExecutor) {
        requireValue('workspaceId', workspaceId);
        media = await this.mediaExecutor.execute({ workspaceId, productionId, brandId, workerId, asset });
        if (!media?.artifact) throw new Error(`Durable media executor did not persist asset ${asset.asset_id}`);
      } else {
        const mediaFingerprint = canonicalFingerprint({ brandId, productionId, asset });
        const artifactId = `brand:${brandId}:asset:${asset.asset_id}`;
        const mediaIdempotencyKey = `${brandId}:${productionId}:media:${asset.asset_id}:${mediaFingerprint}`;
        const provenanceArtifactId = `${artifactId}:provenance`;
        const provenanceIdempotencyKey = `${mediaIdempotencyKey}:provenance`;
        const cachedArtifact = typeof this.artifactService.getVersionByIdempotency === 'function'
          ? await this.artifactService.getVersionByIdempotency({
            artifactId, type: 'binary', idempotencyKey: mediaIdempotencyKey,
            validationStatus: 'pending_master_validation',
          })
          : null;
        if (cachedArtifact) {
          const cachedProvenanceArtifact = await this.artifactService.getVersionByIdempotency({
            artifactId: provenanceArtifactId, type: 'text', idempotencyKey: provenanceIdempotencyKey,
            validationStatus: 'recorded',
          });
          let recorded = {};
          if (cachedProvenanceArtifact) {
            try { recorded = JSON.parse(cachedProvenanceArtifact.content.toString('utf8')); } catch {}
          }
          media = Object.freeze({
            assetId: asset.asset_id,
            kind: asset.kind,
            contentType: contentTypeForKind(asset.kind),
            bytes: cachedArtifact.content,
            mediaUrl: null,
            temporal: asset.temporal || asset.generation_requirements?.temporal || null,
            provider: recorded.provider || cachedArtifact.provenance.provider || 'immutable-artifact-cache',
            model: recorded.model || cachedArtifact.provenance.model,
            requestId: recorded.requestId || null,
            usage: recorded.usage || null,
            provenance: Object.freeze({ ...(recorded.provenance || {}), source: 'immutable-artifact-cache' }),
            brandId,
            artifact: cachedArtifact,
            provenanceArtifact: cachedProvenanceArtifact,
          });
        } else {
          media = await generateMediaAsset({
            providerGateway: this.providerGateway,
            asset,
            productionId,
            brandId,
            workerId,
          });
          if (!media.bytes) {
            const error = new Error(`Generated media ${asset.asset_id} must contain durable bytes`);
            error.code = 'MASTER_MEDIA_MUST_BE_DURABLE';
            throw error;
          }
          const artifact = await this.artifactService.createVersion({
            artifactId,
            type: 'binary',
            content: media.bytes,
            idempotencyKey: mediaIdempotencyKey,
            provider: media.provider,
            model: media.model,
            validationStatus: 'pending_master_validation',
          });
          const provenanceArtifact = await this.artifactService.createVersion({
            artifactId: provenanceArtifactId,
            type: 'text',
            content: JSON.stringify({
              schemaVersion: 1,
              brandId,
              productionId,
              assetId: asset.asset_id,
              contentType: media.contentType,
              provider: media.provider,
              model: media.model,
              requestId: media.requestId,
              usage: media.usage,
              provenance: media.provenance,
              sourceMediaUrl: media.mediaUrl,
              mediaArtifactStorageKey: artifact.storageKey,
            }),
            idempotencyKey: provenanceIdempotencyKey,
            provider: media.provider,
            model: media.model,
            validationStatus: 'recorded',
          });
          media = Object.freeze({ ...media, brandId, artifact, provenanceArtifact });
        }
      }
      if (asset.kind === 'video' && this.sourceQualityEvaluator) {
        let evaluation;
        try {
          evaluation = await this.sourceQualityEvaluator.evaluate({ media, creativePlan: qualityPolicy.creativePlan || null,
            negativeIntent: asset.generation_requirements?.negative_intent || null,
            expectedAspectRatio: asset.generation_requirements?.aspect_ratio || '9:16', intendedContentType: 'cinematic',
            qualityTier, provider: media.provider, model: media.model,
            generationSettings: asset.generation_requirements?.resolved_settings || {}, motionExpected: true,
            evaluationClass: 'SOURCE' });
        } catch (cause) {
          evaluation = structuredQualityResult({ qualityClass: 'SOURCE_VISUAL_GATE', tier: qualityTier, checks: [qualityCheck({
            code: cause.code || REASON_CODES.FRAME_CORRUPTION, status: 'FAIL', qualityClass: 'SOURCE_VISUAL',
            reason: `Source frame analysis failed: ${cause.message}`,
          })], metadata: { evaluatorVersion: 'v2.9', provider: media.provider, model: media.model } });
        }
        rawSourceEvaluations.push(Object.freeze({ assetId: asset.asset_id, shotIds: asset.required_for_shots,
          provider: media.provider, model: media.model, evaluation }));
        const persisted = await persistVisualQualityEvidence({ artifactService: this.artifactService, brandId, productionId,
          assetId: asset.asset_id, sourceArtifact: media.artifact, evaluation, evaluationClass: 'source' });
        sourceEvaluations.push(Object.freeze({ assetId: asset.asset_id, shotIds: asset.required_for_shots,
          provider: media.provider, model: media.model, profile: qualityTier,
          seed: asset.generation_requirements?.seed ?? null,
          canonicalPrompt: asset.generation_requirements?.prompt || null,
          providerTranslatedPrompt: media.provenance?.providerTranslatedPrompt || media.provenance?.input?.prompt || null,
          sourceProbe: media.mediaProbe || null,
          generationSettings: asset.generation_requirements?.resolved_settings || {}, ...persisted }));
        if (persisted.status === 'FAIL') {
          const sourceQuality = Object.freeze({ ...combineResults({ qualityClass: 'SOURCE_QUALITY', tier: qualityTier,
            results: sourceEvaluations }), shots: Object.freeze(sourceEvaluations),
            deterministicVisual: persisted.deterministicVisual || null, temporal: persisted.temporal || null,
            semantic: persisted.semantic || null });
          const quality = buildProductionQuality({ tier: qualityTier, preExecution: preExecutionValidation,
            sourceQuality });
          const error = new Error(`Source visual quality failed for ${asset.asset_id}; master assembly was blocked`);
          error.code = 'SOURCE_QUALITY_VALIDATION_FAILED';
          error.details = { quality, sourceQuality, providerExecutions: sourceEvaluations.length,
            paidRegenerationTriggered: false, nextAction: 'REGENERATE_SHOT' };
          throw error;
        }
      }
      mediaResults.push(media);
    }

    let continuityQuality = null;
    if (this.sourceQualityEvaluator?.evaluateContinuity) {
      try {
        continuityQuality = await this.sourceQualityEvaluator.evaluateContinuity({ shotEvaluations: rawSourceEvaluations,
          creativePlan: qualityPolicy.creativePlan || null, qualityTier });
      } catch (cause) {
        continuityQuality = structuredQualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier: qualityTier,
          checks: [qualityCheck({ code: REASON_CODES.CONTINUITY_FAILURE, status: 'FAIL', qualityClass: 'CONTINUITY_QUALITY',
            reason: `Cross-shot continuity evaluation failed: ${cause.message}`, hardFailure: false })],
          metadata: { evaluatorVersion: 'v2.9' } });
      }
    }
    const sourceQuality = this.sourceQualityEvaluator
      ? Object.freeze({ ...combineResults({ qualityClass: 'SOURCE_QUALITY', tier: qualityTier,
        results: [...sourceEvaluations, continuityQuality].filter(Boolean) }),
        shots: Object.freeze(sourceEvaluations),
        deterministicVisual: combineResults({ qualityClass: 'SOURCE_VISUAL', tier: qualityTier,
          results: sourceEvaluations.map((item) => item.deterministicVisual).filter(Boolean) }),
        temporal: combineResults({ qualityClass: 'TEMPORAL_QUALITY', tier: qualityTier,
          results: sourceEvaluations.map((item) => item.temporal).filter(Boolean) }),
        semantic: combineResults({ qualityClass: 'CREATIVE_COMPLIANCE', tier: qualityTier,
          results: sourceEvaluations.map((item) => item.semantic).filter(Boolean) }),
        continuity: continuityQuality })
      : null;
    if (sourceQuality?.status === 'FAIL') {
      const quality = buildProductionQuality({ tier: qualityTier, preExecution: preExecutionValidation, sourceQuality });
      const error = new Error('Source semantic or continuity quality failed; master assembly was blocked');
      error.code = 'SOURCE_QUALITY_VALIDATION_FAILED';
      error.details = { quality, sourceQuality, providerExecutions: sourceEvaluations.length,
        paidRegenerationTriggered: false, nextAction: 'REGENERATE_SHOT' };
      throw error;
    }
    const audioQuality = this.audioQualityEvaluator?.evaluate({ mediaResults, expectedDurationMs: timeline.durationMs,
      speechExpected: settings.requireVoiceForSpokenCopy, qualityTier }) || null;
    const editorialQuality = this.editorialQualityEvaluator?.evaluate({ timeline, shotPlan, script, qualityTier }) || null;
    if (audioQuality?.status === 'FAIL' || editorialQuality?.status === 'FAIL') {
      const quality = buildProductionQuality({ tier: qualityTier, preExecution: preExecutionValidation,
        sourceQuality, audioQuality, editorialQuality });
      const error = new Error('Source audio or editorial quality failed; master assembly was blocked');
      error.code = 'SOURCE_EDITORIAL_QUALITY_FAILED';
      error.details = { quality, sourceQuality, audioQuality, editorialQuality,
        paidRegenerationTriggered: false, nextAction: 'REVISE_OR_REGENERATE' };
      throw error;
    }

    const assembly = assembleMedia({ timeline, mediaResults });
    const rendered = await this.renderer.render({
      assembly,
      profile: { width: settings.width, height: settings.height, fps: settings.fps },
    });
    const mediaValidation = this.masterProbeValidator ? this.masterProbeValidator({
      probe: rendered.probe, width: settings.width, height: settings.height,
      durationMs: timeline.durationMs, durationToleranceMs: settings.durationToleranceMs,
      requireAudio: true,
    }) : null;
    const postRenderValidation = validatePostRenderQuality({ timeline, probe: rendered.probe, policy: settings });
    let finalEvaluation = null;
    if (this.finalQualityEvaluator) {
      const masterMedia = { bytes: rendered.output, contentType: rendered.contentType,
        mediaProbe: rendered.probe, provider: 'ffmpeg', model: 'master' };
      try {
        finalEvaluation = await this.finalQualityEvaluator.evaluate({ media: masterMedia,
          creativePlan: qualityPolicy.creativePlan || null, expectedAspectRatio: '9:16', intendedContentType: 'final-master',
          qualityTier, provider: 'ffmpeg', model: 'master', generationSettings: rendered.provenance?.profile || {},
          motionExpected: true, evaluationClass: 'FINAL',
          semanticEvaluationRequired: finalSemanticEvaluationRequired });
      } catch (cause) {
        finalEvaluation = structuredQualityResult({ qualityClass: 'FINAL_VISUAL_GATE', tier: qualityTier, checks: [qualityCheck({
          code: cause.code || REASON_CODES.FRAME_CORRUPTION, status: 'FAIL', qualityClass: 'FINAL_QUALITY',
          reason: `Final-master frame analysis failed: ${cause.message}`,
        })], metadata: { evaluatorVersion: 'v2.9', provider: 'ffmpeg', model: 'master' } });
      }
    }
    const provisionalFinalQuality = finalEvaluation ? jsonSafe(finalEvaluation) : null;
    const provisionalQuality = this.sourceQualityEvaluator
      ? buildProductionQuality({ tier: qualityTier, preExecution: preExecutionValidation, sourceQuality,
        audioQuality, editorialQuality, masterTechnical: postRenderValidation, finalQuality: provisionalFinalQuality })
      : combineQuality(preExecutionValidation, postRenderValidation);
    const fingerprint = canonicalFingerprint({ brandId, productionId, script, shotPlan, assetPlan, settings });
    const artifact = await this.artifactService.createVersion({
      artifactId: `production:${productionId}:master`,
      type: 'binary',
      content: rendered.output,
      idempotencyKey: `${brandId}:${productionId}:master:${fingerprint}`,
      provider: rendered.provenance?.renderer || 'ffmpeg',
      model: rendered.provenance?.profile ? JSON.stringify(rendered.provenance.profile) : null,
      validationStatus: provisionalQuality.status === 'FAIL' ? 'failed' : 'awaiting_human_approval',
    });
    const finalQuality = finalEvaluation ? await persistVisualQualityEvidence({ artifactService: this.artifactService,
      brandId, productionId, assetId: `master-${productionId}`, sourceArtifact: artifact,
      evaluation: finalEvaluation, evaluationClass: 'final' }) : null;
    const quality = this.sourceQualityEvaluator
      ? buildProductionQuality({ tier: qualityTier, preExecution: preExecutionValidation, sourceQuality,
        audioQuality, editorialQuality, masterTechnical: postRenderValidation, finalQuality })
      : provisionalQuality;

    const result = Object.freeze({
      productionId,
      brandId,
      fingerprint,
      timeline,
      assembly,
      master: Object.freeze({ artifact, contentType: rendered.contentType, probe: rendered.probe }),
      mediaValidation,
      quality,
      nextAction: quality.readyForHumanReview ? 'HUMAN_REVIEW' : 'REVISE',
    });
    if (quality.readyForHumanReview && this.reviewService) {
      await this.reviewService.registerMasterForReview({
        productionId,
        brandId,
        master: result.master,
        script,
        quality,
        mediaResults,
      });
    }
    return result;
  }
}

module.exports = {
  DEFAULT_QUALITY_POLICY,
  FINAL_MASTER_DELIVERY_PROFILE,
  MasterProductionOrchestrator,
  assertBrandScope,
  buildMasterTimeline,
  canonicalFingerprint,
  combineQuality,
  contentTypeForKind,
  validateMasterQuality,
  validatePostRenderQuality,
  validatePreExecutionQuality,
  persistVisualQualityEvidence,
};
